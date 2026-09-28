import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { loadConfig } from '../config.js';
import type { SourceEngine } from './source/index.js';
import type { Downloader } from './download/index.js';
import type { Library } from './library/index.js';

export interface PlayResolution {
  playUrl: string;
  origin: 'local' | 'remote';
  title: string;
  artist: string;
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

  /**
   * 解析并返回可播地址。
   *
   * 注意：这里返回的 playUrl 是**相对路径**，调用方负责拼绝对地址。
   */
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

  /** 本地文件流（供 /stream 路由） */
  streamPath(relPath: string): { abs: string; size: number } | null {
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    const abs = path.resolve(root, relPath);
    // 防目录穿越：解析后必须仍在音乐库根目录内
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(abs)) return null;
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { abs, size: st.size };
  }
}
