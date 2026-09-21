import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

export interface ScrapeResult {
  file: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  hasCover: boolean;
}

/**
 * 刮削服务：读取音频标签（本地刮削）。
 * 不主动联网抓取，仅做元数据读取与缺失回填建议。
 */
export class Scraper {
  /** 读取单个文件元数据 */
  async inspect(absPath: string): Promise<ScrapeResult | null> {
    try {
      const md = await parseFile(absPath, { duration: true });
      return {
        file: absPath,
        title: md.common.title,
        artist: md.common.artist,
        album: md.common.album,
        duration: md.format.duration,
        hasCover: (md.common.picture?.length ?? 0) > 0,
      };
    } catch (e) {
      logger.debug({ file: absPath, err: String(e) }, '读取标签失败');
      return null;
    }
  }

  /** 扫描曲库，统计元数据完整度 */
  async audit(limit = 200): Promise<{ checked: number; missingCover: number; missingMeta: number }> {
    const cfg = loadConfig();
    const files: string[] = [];
    const walk = (dir: string) => {
      if (files.length >= limit) return;
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (files.length >= limit) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(flac|mp3|m4a|wav|ogg)$/i.test(e.name)) files.push(full);
      }
    };
    walk(cfg.musicDir);

    let missingCover = 0;
    let missingMeta = 0;
    for (const f of files) {
      const r = await this.inspect(f);
      if (!r) { missingMeta++; continue; }
      if (!r.hasCover) missingCover++;
      if (!r.title || !r.artist) missingMeta++;
    }
    logger.info({ checked: files.length, missingCover, missingMeta }, '元数据审计完成');
    return { checked: files.length, missingCover, missingMeta };
  }
}
