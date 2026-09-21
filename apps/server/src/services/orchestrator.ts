import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { loadConfig } from '../config.js';
import type { SourceEngine } from './source/index.js';
import type { Downloader } from './download/index.js';
import type { Library } from './library/index.js';

export interface PlayResolution {
  /** 播放地址（本地文件走 /stream，在线走直链代理） */
  playUrl: string;
  /** 来源：local 表示本地曲库直接命中 */
  origin: 'local' | 'remote';
  title: string;
  artist: string;
  /** 是否已触发后台落库 */
  fetching: boolean;
}

/**
 * 中枢编排：本地优先 → 命中直接播；未命中走音源并异步落库。
 */
export class Orchestrator {
  constructor(
    private engine: SourceEngine,
    private downloader: Downloader,
    private lib: Library,
  ) {}

  async resolveAndPlay(keyword: string, artist?: string, quality?: string): Promise<PlayResolution | null> {
    const cfg = loadConfig();

    // 1) 本地优先
    const local = this.lib.find(keyword, artist);
    if (local) {
      logger.info({ title: local.title, artist: local.artist }, '本地曲库命中');
      return {
        playUrl: `/stream/${encodeURIComponent(local.filePath)}`,
        origin: 'local',
        title: local.title,
        artist: local.artist,
        fetching: false,
      };
    }

    // 2) 走音源
    const hit = await this.engine.resolve(keyword, artist, quality);
    if (!hit) return null;

    // 3) 异步落库（不阻塞播放返回）
    let fetching = false;
    if (cfg.autoFetch) {
      this.downloader.enqueue(hit.song, hit.url);
      fetching = true;
    }

    return {
      playUrl: `/proxy?url=${encodeURIComponent(hit.url.url)}`,
      origin: 'remote',
      title: hit.song.title,
      artist: hit.song.artist,
      fetching,
    };
  }

  /** 本地文件流式读取（供 /stream 路由） */
  streamPath(relPath: string): { abs: string; size: number } | null {
    const cfg = loadConfig();
    const abs = path.join(cfg.musicDir, relPath);
    // 防目录穿越
    if (!abs.startsWith(path.resolve(cfg.musicDir))) return null;
    if (!fs.existsSync(abs)) return null;
    return { abs, size: fs.statSync(abs).size };
  }
}
