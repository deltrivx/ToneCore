import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { logger } from '../../logger.js';
import type { SourceAdapter, Song, SongUrl } from './types.js';

/**
 * 洛雪音源脚本加载器。
 *
 * 洛雪脚本是 CommonJS 风格，通过全局注册自己：
 *   globalThis.lx.send(...)  /  lx.request(...)
 * 本加载器在 Node vm 沙箱里跑脚本，注入最小 lx 运行时，
 * 把 script 的 search / getMusicUrl 桥接成 SourceAdapter。
 */

interface ScriptHandle {
  name: string;
  platforms: string[];
  search(platform: string, keyword: string, page: number): Promise<Song[]>;
  getMusicUrl(platform: string, song: Song, quality: string): Promise<SongUrl | null>;
}

/** 从脚本源码里解析 name / platforms（洛雪脚本元信息是注释或 lx.register 调用） */
function parseMeta(code: string, filename: string): { name: string; platforms: string[] } {
  let name = path.basename(filename, '.js');
  let platforms: string[] = [];

  const nameM = code.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
  if (nameM) name = nameM[1];

  // 常见写法：{ kw: {...}, tx: {...} } 或 sources: ['kw','tx']
  const platKey = code.match(/(?:sources|platforms)\s*:\s*\[([^\]]+)\]/);
  if (platKey) {
    platforms = platKey[1].split(',').map((s) => s.trim().replace(/['"`\s]/g, '')).filter(Boolean);
  }
  if (platforms.length === 0) {
    const found = new Set<string>();
    for (const p of ['kw', 'kg', 'tx', 'wy', 'mg']) {
      if (new RegExp(`\b${p}\s*:`).test(code)) found.add(p);
    }
    platforms = [...found];
  }
  return { name, platforms };
}

export class SourceLoader {
  private scripts: ScriptHandle[] = [];
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  get count(): number { return this.scripts.length; }

  list(): { name: string; platforms: string[] }[] {
    return this.scripts.map((s) => ({ name: s.name, platforms: s.platforms }));
  }

  /** 扫描目录并加载全部音源脚本 */
  loadAll(): void {
    this.scripts = [];
    if (!fs.existsSync(this.dir)) {
      logger.warn({ dir: this.dir }, '音源目录不存在');
      return;
    }
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      try {
        const h = this.loadOne(path.join(this.dir, f));
        if (h) this.scripts.push(h);
      } catch (e) {
        logger.warn({ file: f, err: String(e) }, '音源脚本加载失败');
      }
    }
    logger.info({ count: this.scripts.length, dir: this.dir }, '音源脚本已加载');
  }

  private loadOne(file: string): ScriptHandle | null {
    const code = fs.readFileSync(file, 'utf8');
    const meta = parseMeta(code, file);
    if (meta.platforms.length === 0) return null;

    // 沙箱：注入极简 lx 运行时
    const registered: Record<string, unknown> = {};
    const sandbox: Record<string, unknown> = {
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      JSON,
      Math,
      Date,
      Buffer,
      URL,
      fetch,
      __registered: registered,
      lx: {
        /** 脚本用 lx.send 上报结果 */
        send(eventName: string, data: unknown) { registered[eventName] = data; },
        /** 脚本用 lx.request 发请求 */
        async request(url: string, opts: Record<string, unknown> = {}) {
          const res = await fetch(url, opts as RequestInit);
          return await res.text();
        },
        on() { /* noop */ },
      },
    };
    vm.createContext(sandbox);
    try {
      vm.runInContext(code, sandbox, { filename: file, timeout: 5000 });
    } catch (e) {
      logger.warn({ file, err: String(e) }, '音源脚本执行异常');
    }

    // 洛雪脚本暴露在 sandbox 里的钩子（不同脚本写法不一，取常见的几种）
    const hooks = sandbox as Record<string, any>;
    const searchFn = hooks.search || hooks.__search__ || registered.search;
    const urlFn = hooks.getMusicUrl || hooks.__getMusicUrl__ || registered.getMusicUrl;

    if (typeof searchFn !== 'function' && typeof urlFn !== 'function') {
      logger.debug({ file }, '脚本未暴露 search/getMusicUrl，跳过');
      return null;
    }

    return {
      name: meta.name,
      platforms: meta.platforms,
      async search(platform, keyword, page) {
        if (typeof searchFn !== 'function') return [];
        const raw = await searchFn(keyword, page, platform);
        return normalizeSongs(raw, platform);
      },
      async getMusicUrl(platform, song, quality) {
        if (typeof urlFn !== 'function') return null;
        const raw = await urlFn(song, quality);
        const url = typeof raw === 'string' ? raw : raw?.url;
        if (!url) return null;
        return { url, quality, source: meta.name };
      },
    };
  }

  /** 按平台找到可用脚本 */
  forPlatform(platform: string): ScriptHandle[] {
    return this.scripts.filter((s) => s.platforms.includes(platform));
  }
}

/** 把各脚本返回的异构结果规整成统一 Song[] */
export function normalizeSongs(raw: unknown, platform: string): Song[] {
  const list = Array.isArray(raw) ? raw : (raw as any)?.list || (raw as any)?.data || [];
  return (list as any[]).map((s) => ({
    platform,
    id: String(s.songmid ?? s.id ?? s.musicId ?? s.hash ?? ''),
    title: String(s.name ?? s.title ?? ''),
    artist: String(s.singer ?? s.artist ?? ''),
    album: s.albumName ?? s.album ?? undefined,
    duration: s.duration ?? s.interval ? toSeconds(s.duration ?? s.interval) : undefined,
    coverUrl: s.img ?? s.pic ?? s.cover_url ?? undefined,
    qualities: (s.types ?? s._types) ? Object.keys(s._types || {}).length
      ? Object.keys(s._types)
      : (s.types as any[]).map((t: any) => t.type) : undefined,
  })).filter((s) => s.id && s.title);
}

function toSeconds(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.includes(':')) {
    const [m, s] = v.split(':').map(Number);
    return m * 60 + (s || 0);
  }
  return undefined;
}

export type { ScriptHandle };
