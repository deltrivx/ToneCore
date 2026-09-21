import vm from 'node:vm';
import crypto from 'node:crypto';
import { logger } from '../../logger.js';

/**
 * 洛雪音乐（LX Music）音源脚本运行时。
 *
 * 脚本通过全局 `lx` 对象与宿主通信：
 *   lx.send(event, data)            脚本 → 宿主 上报
 *   lx.on(event, handler)           脚本注册事件处理器
 *   lx.request(url, opts, cb)       脚本请求宿主代理 HTTP
 *
 * 关键事件：
 *   'inited'   初始化完成：{ status, name, sources: {kw:{...}, tx:{...}} }
 *   'request'  宿主向脚本派发任务（搜歌/取链），脚本调用 lx.send('request', payload)
 */

export interface LxSourceInfo {
  name?: string;
  type?: string;
  actions?: string[];
  qualitys?: string[];
}

export interface LxInitedPayload {
  status?: boolean;
  name?: string;
  sources?: Record<string, LxSourceInfo>;
  version?: string;
}

interface PendingTask {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  /** 用于匹配脚本回来的响应 */
  expectId: string;
}

export interface LxScriptInstance {
  name: string;
  platforms: string[];
  sources: Record<string, LxSourceInfo>;
  /** 派发任务给脚本：action = 'musicUrl' | 'lyric' | 'pic' | ... */
  invoke(payload: Record<string, unknown>): Promise<unknown>;
  onAlert?: (msg: string) => void;
  dispose(): void;
}

/** 构造洛雪脚本所需的 `lx` 全局对象 */
function buildLx(
  onSend: (event: string, data: unknown) => void,
  onHttp: (req: Record<string, unknown>) => void,
  scriptName: string,
): Record<string, unknown> {
  const handlers: Record<string, (payload: unknown) => void> = {};

  const utils = {
    buffer: {
      from: (...a: unknown[]) => Buffer.from(...(a as [any])),
      bufToString: (buf: unknown, format?: string) =>
        Buffer.isBuffer(buf) ? buf.toString((format || 'utf8') as BufferEncoding) : String(buf),
      concat: (arr: unknown[]) => Buffer.concat(arr as Buffer[]),
    },
    crypto: {
      md5: (s: string | Buffer) => crypto.createHash('md5').update(s as any).digest('hex'),
      sha1: (s: string | Buffer) => crypto.createHash('sha1').update(s as any).digest('hex'),
      randomBytes: (n: number) => crypto.randomBytes(n).toString('hex'),
      aesEncrypt: (buf: Buffer, mode: string, key: Buffer, iv: Buffer) => {
        const c = crypto.createCipheriv(mode as any, key, iv);
        return Buffer.concat([c.update(buf), c.final()]);
      },
      aesDecrypt: (buf: Buffer, mode: string, key: Buffer, iv: Buffer) => {
        const d = crypto.createDecipheriv(mode as any, key, iv);
        return Buffer.concat([d.update(buf), d.final()]);
      },
      rsaEncrypt: (buf: Buffer, key: string) => {
        const pub = crypto.createPublicKey({ key, format: 'pem' });
        return crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, buf);
      },
    },
  };

  const lx: Record<string, unknown> = {
    send(eventName: string, data: unknown) {
      try { onSend(eventName, data); }
      catch (e) { logger.debug({ scriptName, eventName, err: String(e) }, 'lx.send 异常'); }
    },

    on(eventName: string, handler: (payload: unknown) => void) {
      handlers[eventName] = handler;
    },

    off(eventName: string) {
      delete handlers[eventName];
    },

    request(
      url: string,
      opts: unknown,
      cb?: unknown,
    ) {
      let options: Record<string, unknown> = {};
      let callback = cb as ((e: Error | null, r: unknown, b: unknown) => void) | undefined;
      if (typeof opts === 'function') callback = opts as any;
      else options = (opts as Record<string, unknown>) || {};
      onHttp({ url, ...options, callback });
    },

    utils,
    version: '2.6.0',

    ENV: {
      getUserAgent: () =>
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      os: 'win10',
      version: '2.6.0',
    },

    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    currentScriptInfo: { name: scriptName, description: '', version: '' },

    /** 内部：暴露给宿主拿 handler（非洛雪规范，仅供运行时使用） */
    __getHandler: (name: string) => handlers[name],
    __handlers: handlers,
  };

  return lx;
}

/** 加载单个洛雪脚本 */
export function loadLxScript(filePath: string, code: string): Promise<LxScriptInstance | null> {
  return new Promise((resolve) => {
    let inited: LxInitedPayload | null = null;
    let requestHandler: ((payload: unknown) => void) | null = null;
    let alertHandler: ((msg: string) => void) | null = null;
    let disposed = false;
    const pending = new Map<string, PendingTask>();

    const onSend = (event: string, data: unknown) => {
      if (event === 'inited') {
        inited = data as LxInitedPayload;
        return;
      }
      if (event === 'updateAlert') {
        const d = data as { message?: string };
        if (d?.message) alertHandler?.(d.message);
        return;
      }
      if (event === 'request') {
        // 脚本回填任务结果：data = { requestKey, status, data } 或 { id, result }
        const d = data as Record<string, unknown>;
        const key = String(d?.requestKey ?? d?.id ?? '');
        const task = pending.get(key);
        if (task) {
          clearTimeout(task.timer);
          pending.delete(key);
          if (d?.status === false) task.reject(new Error(String(d?.message ?? '脚本返回失败')));
          else task.resolve(d?.data ?? d?.result ?? d);
        }
        return;
      }
    };

    const onHttp = (req: Record<string, unknown>) => {
      void (async () => {
        const url = String(req.url || '');
        const method = String(req.method || 'GET');
        const headers = (req.headers as Record<string, string>) || {};
        const body = req.body;
        const form = req.form as Record<string, string> | undefined;
        const formData = req.formData as Record<string, string> | undefined;
        const timeout = Number(req.timeout) || 15000;
        const callback = req.callback as
          | ((e: Error | null, r: unknown, b: unknown) => void)
          | undefined;
        try {
          const init: RequestInit = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeout) };
          if (form) {
            (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
            init.body = new URLSearchParams(form).toString();
          } else if (formData) {
            init.body = new URLSearchParams(formData).toString();
          } else if (typeof body === 'string') {
            init.body = body;
          } else if (body) {
            (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
          }
          const res = await fetch(url, init);
          const text = await res.text();
          let parsed: unknown = text;
          try { parsed = JSON.parse(text); } catch { /* 保留文本 */ }
          callback?.(
            null,
            { statusCode: res.status, headers: Object.fromEntries(res.headers.entries()), body: parsed, raw: text },
            parsed,
          );
        } catch (e) {
          callback?.(e as Error, null, null);
        }
      })();
    };

    const lx = buildLx(onSend, onHttp, filePath.split('/').pop() || 'unknown');

    const sandbox: Record<string, unknown> = {
      lx,
      console: {
        log: (...a: unknown[]) => logger.debug({ src: filePath }, a.map(String).join(' ')),
        warn: (...a: unknown[]) => logger.debug({ src: filePath }, a.map(String).join(' ')),
        error: (...a: unknown[]) => logger.debug({ src: filePath }, a.map(String).join(' ')),
        info: (...a: unknown[]) => logger.debug({ src: filePath }, a.map(String).join(' ')),
        debug: () => {},
      },
      setTimeout, clearTimeout, setInterval, clearInterval,
      Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
      JSON, Math, Date, Promise, Object, Array, String, Number, Boolean,
      RegExp, Error, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect,
      encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
      parseInt, parseFloat, isNaN, isFinite, escape, unescape,
      fetch,
      process: { env: {}, platform: 'linux', version: 'v20.0.0', nextTick: (f: () => void) => setTimeout(f, 0) },
      __filename: filePath,
      __dirname: filePath.replace(/\/[^/]+$/, ''),
    };
    sandbox.globalThis = sandbox;

    const ctx = vm.createContext(sandbox);
    try {
      vm.runInContext(code, ctx, { filename: filePath, timeout: 15000 });
    } catch (e) {
      logger.warn({ file: filePath, err: String(e).slice(0, 200) }, '洛雪脚本执行失败');
      resolve(null);
      return;
    }

    // 等 inited（脚本可能异步 init）
    const finish = () => {
      if (disposed) return;
      if (!inited) {
        logger.debug({ file: filePath }, '脚本未上报 inited，跳过');
        resolve(null);
        return;
      }
      const sources = inited.sources || {};
      const platforms = Object.keys(sources);
      if (platforms.length === 0) {
        logger.debug({ file: filePath, name: inited.name }, '脚本无可用平台');
        resolve(null);
        return;
      }

      requestHandler = (lx.__getHandler as (n: string) => ((p: unknown) => void) | null)('request');
      alertHandler = (lx.__getHandler as (n: string) => ((m: string) => void) | null)('updateAlert');

      resolve({
        name: inited.name || filePath.split('/').pop() || 'unknown',
        platforms,
        sources,
        async invoke(payload: Record<string, unknown>): Promise<unknown> {
          if (!requestHandler) throw new Error('脚本未注册 request 处理器');
          const requestKey = crypto.randomBytes(8).toString('hex');
          return await new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(requestKey);
              rej(new Error('脚本响应超时(30s)'));
            }, 30000);
            pending.set(requestKey, { resolve: res, reject: rej, timer, expectId: requestKey });
            try {
              requestHandler!({ ...payload, requestKey });
            } catch (e) {
              clearTimeout(timer);
              pending.delete(requestKey);
              rej(e as Error);
            }
          });
        },
        onAlert: alertHandler || undefined,
        dispose() { disposed = true; },
      } satisfies LxScriptInstance);
    };

    setTimeout(finish, 500);
  });
}
