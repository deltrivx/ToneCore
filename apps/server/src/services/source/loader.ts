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
    }));
  }

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
        }
      } catch (e) {
        logger.debug({ file: f, err: String(e).slice(0, 120) }, '音源加载失败');
      }
    }
    logger.info({ count: this.scripts.length, dir: this.dir }, '音源加载完成');
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

      const finish = (result: SongUrl | null) => {
        if (done) return;
        done = true;
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(result);
      };

      // 硬超时：到点必须返回，避免上游静默丢弃导致请求悬挂
      timer = setTimeout(() => {
        logger.warn({ platform, title: song.title, timeoutMs }, '取链整体超时，放弃本平台');
        for (const s of list) this.health.recordFailure(s.name);
        finish(null);
      }, timeoutMs);

      const onSettled = () => {
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
            onSettled();
          }
        }).catch((e) => {
          this.health.recordFailure(s.name);
          logger.debug({ script: s.name, title: song.title, err: String(e).slice(0, 100) }, '取链失败');
          onSettled();
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
