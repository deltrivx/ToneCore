import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadLxScript, type LxScriptInstance, type LxSourceInfo } from './lx-runtime.js';
import type { Song, SongUrl } from './types.js';

/**
 * 洛雪音源脚本管理器。
 *
 * 职责边界（已实测确认）：
 *   ✅ 取直链：invoke({ source, action:'musicUrl', info:{ musicInfo, type } })
 *   ❌ 搜索：洛雪脚本不支持，由 SearchEngine（宿主自研）负责
 *
 * 脚本通过 lx.send('request', { requestKey, status, data }) 回填结果。
 */

export interface SourceMeta {
  name: string;
  platforms: string[];
  sources: Record<string, LxSourceInfo>;
  file: string;
}

export class SourceLoader {
  private scripts: (LxScriptInstance & { file: string })[] = [];
  private dir: string;

  constructor(dir: string) { this.dir = dir; }

  get count(): number { return this.scripts.length; }

  list(): SourceMeta[] {
    return this.scripts.map((s) => ({
      name: s.name, platforms: s.platforms, sources: s.sources, file: s.file,
    }));
  }

  /** 异步加载全部脚本 */
  async loadAll(): Promise<void> {
    this.scripts.forEach((s) => { try { s.dispose(); } catch { /* ignore */ } });
    this.scripts = [];

    if (!fs.existsSync(this.dir)) {
      logger.warn({ dir: this.dir }, '音源目录不存在');
      return;
    }
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const full = path.join(this.dir, f);
      try {
        const code = fs.readFileSync(full, 'utf8');
        const inst = await loadLxScript(full, code);
        if (inst) {
          this.scripts.push(Object.assign(inst, { file: f }));
          logger.info({ script: inst.name, platforms: inst.platforms }, '音源已加载');
        }
      } catch (e) {
        logger.warn({ file: f, err: String(e).slice(0, 150) }, '音源加载失败');
      }
    }
    logger.info({ count: this.scripts.length, dir: this.dir }, '音源加载完成');
  }

  /** 按平台筛可用脚本 */
  forPlatform(platform: string) {
    // 允许脚本用 'qs'(汽水) 等别名，主流程只看标准平台
    return this.scripts.filter((s) => s.platforms.includes(platform));
  }

  /**
   * 取直链（唯一由脚本提供的能力）。
   * 多个脚本依次尝试，成功即返回。
   */
  async getUrl(platform: string, song: Song, quality: string): Promise<SongUrl | null> {
    const list = this.forPlatform(platform);
    for (const s of list) {
      try {
        const raw = await s.invoke({
          source: platform,
          action: 'musicUrl',
          info: { musicInfo: song.raw ?? song, type: quality },
        });
        const url = extractUrl(raw);
        if (url) {
          logger.debug({ script: s.name, platform, quality, title: song.title }, '取链成功');
          return { url, quality, source: s.name };
        }
      } catch (e) {
        logger.debug({ script: s.name, title: song.title, err: String(e).slice(0, 120) }, '取链失败');
      }
    }
    return null;
  }

  /** 支持某平台的脚本数量 */
  countForPlatform(platform: string): number {
    return this.forPlatform(platform).length;
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
