import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadLxScript, type LxScriptInstance, type LxSourceInfo } from './lx-runtime.js';
import { HealthTracker } from './health.js';
import type { Song, SongUrl } from './types.js';

/**
 * 洛雪音源脚本管理器。
 *
 * 职责边界（实测确认）：
 *   ✅ 取直链：invoke({ source, action:'musicUrl', info:{ musicInfo, type } })
 *   ❌ 搜索：洛雪脚本不支持，由 SearchEngine（宿主自研）负责
 *
 * 取链策略：多脚本并行派发，谁先成功用谁（借鉴 SongLoft 多源选优思路），
 * 结合健康度打分排序 + 连续失败熔断。
 */

export interface SourceMeta {
  name: string;
  platforms: string[];
  sources: Record<string, LxSourceInfo>;
  file: string;
  health: number;
  /** 加载状态：ok / failed */
  loadState?: 'ok' | 'failed';
  /** 加载失败原因 */
  loadError?: string;
  /** 加载失败时间 */
  loadErrorAt?: number;
}

export class SourceLoader {
  private scripts: (LxScriptInstance & { file: string })[] = [];
  private dir: string;
  private health: HealthTracker;

  constructor(dir: string) {
    this.dir = dir;
    this.health = new HealthTracker();
  }

  get count(): number { return this.scripts.length; }
  get healthTracker(): HealthTracker { return this.health; }

  list(): SourceMeta[] {
    return this.scripts.map((s) => ({
      name: s.name, platforms: s.platforms, sources: s.sources, file: s.file,
      health: Math.round(this.health.score(s.name)),
      loadState: 'ok' as const,
    }));
  }

  /** 完整清单：含加载失败的脚本（界面必须能看见它们和失败原因） */
  listAll(): SourceMeta[] {
    const ok = this.list();
    const okFiles = new Set(ok.map((s) => s.file));
    const failed: SourceMeta[] = this.health
      .snapshot()
      .filter((h) => h.loadState === 'failed' && !okFiles.has(h.name))
      .map((h) => ({
        name: h.name, platforms: [], sources: {}, file: h.name,
        health: -1,
        loadState: 'failed' as const,
        loadError: h.loadError,
        loadErrorAt: h.loadErrorAt,
      }));
    return [...ok, ...failed];
  }

  /** 加载失败清单（供健康接口聚合） */
  loadFailures(): { file: string; error: string; at: number }[] {
    return this.health
      .snapshot()
      .filter((h) => h.loadState === 'failed')
      .map((h) => ({ file: h.name, error: h.loadError ?? '未知原因', at: h.loadErrorAt ?? 0 }));
  }

  async loadAll(): Promise<void> {
    this.scripts.forEach((s) => { try { s.dispose(); } catch { /* ignore */ } });
    this.scripts = [];

    if (!fs.existsSync(this.dir)) {
      logger.warn({ dir: this.dir }, '音源目录不存在');
      return;
    }
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.js'));
    // 目录里已不存在的脚本，清掉其历史记录（避免界面残留幽灵条目）
    for (const known of this.health.names()) {
      if (!files.includes(known)) this.health.forget(known);
    }
    for (const f of files) {
      const full = path.join(this.dir, f);
      try {
        const code = fs.readFileSync(full, 'utf8');
        const inst = await loadLxScript(full, code);
        if (inst) {
          this.scripts.push(Object.assign(inst, { file: f }));
          this.health.recordLoaded(f, inst.platforms ?? []);
        } else {
          // 措辞要准确：绝大多数情况不是「缺 module.exports」，而是脚本要先联网
          // 拉配置再上报 inited，却在等待窗口内没完成（上游慢/不可达/格式不兼容）。
          this.health.recordLoadFailure(f, '脚本未上报 inited：联网初始化超时，或脚本格式与本运行时不兼容');
          logger.warn({ file: f }, '音源加载失败：脚本未上报 inited');
        }
      } catch (e) {
        const msg = normalizeLoadError(String(e));
        this.health.recordLoadFailure(f, msg);
        logger.warn({ file: f, err: msg }, '音源加载失败');
      }
    }
    this.health.persist();
    logger.info({ count: this.scripts.length, total: files.length, dir: this.dir }, '音源加载完成');
  }

  /** 按平台筛可用脚本，按健康分降序 */
  forPlatform(platform: string) {
    return this.scripts
      .filter((s) => s.platforms.includes(platform))
      .filter((s) => !this.health.isTripped(s.name))
      .sort((a, b) => this.health.score(b.name) - this.health.score(a.name));
  }

  /**
   * 取直链：多脚本并行，谁先成功用谁。
   *
   * 关键保障：
   *   1) 幂等 resolve —— 无论多少分支，只返回一次
   *   2) 整体硬超时 —— 即使某脚本静默丢弃任务，也必定返回（不再卡死 HTTP）
   *   3) 全部失败/超时 → null，由上层换平台继续尝试
   */
  async getUrl(
    platform: string,
    song: Song,
    quality: string,
    maxParallel = 3,
    timeoutMs = 25000,
  ): Promise<SongUrl | null> {
    const list = this.forPlatform(platform).slice(0, maxParallel);
    if (list.length === 0) return null;

    return new Promise<SongUrl | null>((resolve) => {
      let settled = 0;
      let done = false;
      let timer: NodeJS.Timeout | null = null;
      // 已经给出结论的脚本（成功/失败/无 url）。
      // 用来在整体超时时区分「谁真的没应答」，避免一个慢脚本连坐拖垮同批其它脚本。
      const settledNames = new Set<string>();

      const finish = (result: SongUrl | null) => {
        if (done) return;
        done = true;
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(result);
      };

      // 硬超时：到点必须返回，避免上游静默丢弃导致请求悬挂。
      // 只惩罚到点仍未应答的脚本 —— 已经报过成功/失败的不再重复挂账，
      // 否则一次超时会把整批脚本的健康分一起打下去，进而集体熔断。
      timer = setTimeout(() => {
        const silent = list.filter((s) => !settledNames.has(s.name)).map((s) => s.name);
        for (const n of silent) this.health.recordFailure(n);
        logger.warn({ platform, title: song.title, timeoutMs, silent }, '取链整体超时，放弃本平台');
        finish(null);
      }, timeoutMs);

      const onSettled = (name: string) => {
        settledNames.add(name);
        if (++settled >= list.length) finish(null);
      };

      for (const s of list) {
        const t0 = Date.now();
        s.invoke({
          source: platform,
          action: 'musicUrl',
          info: { musicInfo: song.raw ?? song, type: quality },
        }).then((raw) => {
          const ms = Date.now() - t0;
          const url = extractUrl(raw);
          if (url) {
            this.health.recordSuccess(s.name, ms);
            logger.info({ script: s.name, platform, quality, title: song.title, ms }, '取链成功');
            finish({ url, quality, source: s.name });
          } else {
            this.health.recordFailure(s.name);
            logger.debug({ script: s.name, title: song.title }, '脚本返回无有效 url');
            onSettled(s.name);
          }
        }).catch((e) => {
          this.health.recordFailure(s.name);
          logger.debug({ script: s.name, title: song.title, err: String(e).slice(0, 100) }, '取链失败');
          onSettled(s.name);
        });
      }
    });
  }

  countForPlatform(platform: string): number {
    return this.scripts.filter((s) => s.platforms.includes(platform)).length;
  }

  /** 健康度快照（供 API） */
  healthSnapshot() {
    return this.health.snapshot();
  }

  /**
   * 单脚本取链：只让指定的一个脚本去取，失败就是失败，不做多源兜底。
   * 用于「测一下这个源到底通不通」。
   *
   * 注意只让它取链（musicUrl），**不要传 search** ——
   * 洛雪脚本不实现 search，传过去必然抛
   * `action not support: search` 然后挂到运行时超时。
   */
  async getUrlFromScript(file: string, song: Song, quality: string): Promise<SongUrl | null> {
    const safe = file.split('/').pop() || file;
    const script = this.scripts.find((s) => s.file === safe || s.name === safe);
    if (!script) throw new Error('脚本未加载：' + safe);

    // 该脚本不一定支持这首歌的平台，挑一个它支持的
    const platform = script.platforms.includes(song.platform)
      ? song.platform
      : (script.platforms[0] ?? song.platform);

    const raw = await script.invoke({
      source: platform,
      action: 'musicUrl',
      info: { musicInfo: song.raw ?? song, type: quality },
    });
    const url = extractUrl(raw);
    if (!url) return null;
    return { url, quality, source: script.name };
  }
}

/** 从脚本返回里提取直链（兼容多种返回形态） */
export function extractUrl(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return /^https?:\/\//.test(raw) ? raw : null;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['url', 'data', 'result', 'musicUrl']) {
      const v = o[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
      if (v && typeof v === 'object') {
        const inner = extractUrl(v);
        if (inner) return inner;
      }
    }
  }
  return null;
}


/** 把底层错误转成人能看懂的一句话（界面直接展示） */
export function normalizeLoadError(raw: string): string {
  const r = raw.replace(/^Error:\s*/, '').trim();
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(r)) return '脚本依赖缺失：' + r.slice(0, 160);
  if (/Unexpected token|SyntaxError/i.test(r)) return '脚本语法错误（可能是压缩/加密脚本与本运行时版本不兼容）';
  if (/timeout|ETIMEDOUT/i.test(r)) return '脚本初始化超时（可能需联网校验，网络不通）';
  if (/ENOENT/i.test(r)) return '文件不可读';
  if (/未初始化|not initialized|缺少 inited/i.test(r)) return '脚本未完成初始化（通常是脚本版本过旧，需更新）';
  return r.slice(0, 200) || '未知原因';
}


/** 把脚本搜索返回归一化成 Song[]（兼容多种返回形态） */
export function normalizeSearchResult(raw: unknown): Song[] {
  const arr = Array.isArray(raw) ? raw : (raw as any)?.data ?? (raw as any)?.list ?? [];
  if (!Array.isArray(arr)) return [];
  return arr.map((it: any) => ({
    platform: String(it?.source ?? it?.platform ?? ''),
    id: String(it?.songmid ?? it?.id ?? it?._id ?? it?.hash ?? ''),
    title: String(it?.title ?? it?.name ?? ''),
    artist: String(it?.artist ?? it?.singer ?? ''),
    album: it?.album ? String(it.album) : undefined,
    duration: Number(it?.interval ?? it?.duration ?? 0) || undefined,
    coverUrl: it?.img ? String(it.img) : undefined,
    raw: it,
  })).filter((x) => x.title);
}
