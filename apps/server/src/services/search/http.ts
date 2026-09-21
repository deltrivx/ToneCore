import { logger } from '../../logger.js';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FetchOpts {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

/** 带重试与超时的 JSON 请求 */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const { headers = {}, timeout = 12000, retries = 2 } = opts;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      if (!res.ok) {
        logger.debug({ url: url.slice(0, 100), status: res.status }, 'HTTP 非 200');
        continue;
      }
      // 兼容 jsonp: callback({...})
      let body = text.trim();
      const jsonp = /^[\w$]+\((.*)\)$/s.exec(body);
      if (jsonp) body = jsonp[1];
      return JSON.parse(body) as T;
    } catch (e) {
      if (i === retries) logger.debug({ url: url.slice(0, 100), err: String(e).slice(0, 100) }, '请求失败');
    }
  }
  return null;
}

/** 生成酷我 reqid（其接口需要） */
export function randomHex(len = 32): string {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function toSeconds(v: unknown): number | undefined {
  if (typeof v === 'number' && v > 0) return v > 1000 ? Math.round(v / 1000) : v;
  if (typeof v === 'string') {
    if (v.includes(':')) {
      const [m, sec] = v.split(':').map(Number);
      return (m || 0) * 60 + (sec || 0);
    }
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n > 1000 ? Math.round(n / 1000) : n;
  }
  return undefined;
}
