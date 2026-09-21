import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { writeTags, type TagInput, type WriteResult } from './tags.js';
import { fetchLyrics, fetchCover } from './lyrics.js';
import type { Song } from '../source/types.js';

export interface ScrapeResult {
  file: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  hasCover: boolean;
  /** 是否带歌词标签 */
  hasLyrics?: boolean;
}

export interface ApplyOptions {
  /** 平台标识（决定歌词接口选择） */
  platform?: string;
  /** 平台内歌曲 ID */
  songId?: string;
  /** 平台给出的封面地址（优先用这个，不必再去搜） */
  coverUrl?: string;
  /** 专辑名 */
  album?: string;
  /** 时长（秒） */
  duration?: number;
  /** 跳过联网，只用本地已有信息写标签 */
  offline?: boolean;
}

const AUDIO_EXT = /\.(flac|mp3|m4a|wav|ape|ogg|opus)$/i;

/**
 * 刮削服务：元数据读取 + 写入（标签 / 封面 / 歌词）+ 曲库元数据审计。
 *
 * 与旧版的关键区别：旧版只读不写，README 却承诺「自动刮削嵌入标签封面」。
 * 现在落库完成后会主动补齐标签，并把歌词写成同名 .lrc（可关）。
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
        hasLyrics: Boolean(md.common.lyrics?.length),
      };
    } catch (e) {
      logger.debug({ file: absPath, err: String(e) }, '读取标签失败');
      return null;
    }
  }

  /**
   * 给刚落库的文件补齐标签、封面、歌词。
   *
   * 调用时机：download 落盘成功之后。**任何一步失败都不影响主流程** ——
   * 歌已经下下来了，标签是锦上添花，绝不能因为刮削失败就判定落库失败。
   *
   * 返回写入结果，供日志与界面展示。
   */
  async applyToFile(
    absPath: string,
    song: Pick<Song, 'title' | 'artist' | 'album' | 'coverUrl' | 'platform' | 'id' | 'duration'>,
    opts: ApplyOptions = {},
  ): Promise<{ tags: WriteResult; lyrics: boolean; cover: boolean }> {
    const cfg = loadConfig();
    const emptyTags: WriteResult = { ok: false, written: [], error: '未启用' };

    if (!cfg.embedMetadata) {
      logger.debug({ file: absPath }, 'embedMetadata 已关闭，跳过标签写入');
      return { tags: emptyTags, lyrics: false, cover: false };
    }

    const tag: TagInput = {
      title: song.title || undefined,
      artist: song.artist || undefined,
      album: opts.album || song.album || undefined,
      albumArtist: song.artist || undefined,
    };

    let coverWritten = false;
    let lyricsWritten = false;

    if (!opts.offline) {
      // ---- 封面：优先用平台给的地址 ----
      try {
        const cover = await fetchCover(opts.coverUrl || song.coverUrl, song.title, song.artist);
        if (cover) {
          tag.cover = cover;
          coverWritten = true;
        }
      } catch (e) {
        logger.debug({ file: absPath, err: String(e).slice(0, 120) }, '封面抓取异常（忽略）');
      }

      // ---- 歌词：写入标签 + 同名 .lrc ----
      if (cfg.writeLyrics) {
        try {
          const lyr = await fetchLyrics(song.title, song.artist, opts.platform || song.platform, opts.songId || song.id);
          if (lyr) {
            tag.lyrics = lyr.lrc;
            lyricsWritten = true;
            this.writeLrcFile(absPath, lyr.lrc);
          }
        } catch (e) {
          logger.debug({ file: absPath, err: String(e).slice(0, 120) }, '歌词抓取异常（忽略）');
        }
      }
    }

    const res = await writeTags(absPath, tag);
    if (!res.ok) {
      logger.warn({ file: path.basename(absPath), err: res.error }, '标签写入未完成');
    } else {
      logger.info(
        { file: path.basename(absPath), fields: res.written.length, cover: coverWritten, lyrics: lyricsWritten },
        '标签写入完成',
      );
    }
    return { tags: res, lyrics: lyricsWritten, cover: coverWritten };
  }

  /** 写同名 .lrc（UTF-8）—— 部分播放器只认外挂歌词 */
  private writeLrcFile(absPath: string, lrc: string): void {
    const lrcPath = absPath.replace(/\.[^.]+$/, '') + '.lrc';
    try {
      fs.writeFileSync(lrcPath, lrc, 'utf8');
    } catch (e) {
      logger.debug({ file: lrcPath, err: String(e).slice(0, 120) }, '歌词文件写入失败');
    }
  }

  /** 扫描曲库，统计元数据完整度 */
  async audit(limit = 200): Promise<{
    checked: number;
    missingCover: number;
    missingMeta: number;
    missingLyrics: number;
  }> {
    const cfg = loadConfig();
    const files = this.walkAudio(cfg.musicDir, limit);

    let missingCover = 0;
    let missingMeta = 0;
    let missingLyrics = 0;
    for (const f of files) {
      const r = await this.inspect(f);
      if (!r) { missingMeta++; continue; }
      if (!r.hasCover) missingCover++;
      if (!r.title || !r.artist) missingMeta++;
      if (!r.hasLyrics) missingLyrics++;
    }
    logger.info({ checked: files.length, missingCover, missingMeta, missingLyrics }, '元数据审计完成');
    return { checked: files.length, missingCover, missingMeta, missingLyrics };
  }

  /**
   * 批量补全：扫描曲库，对缺封面 / 缺标签的文件尝试补齐。
   *
   * 这是「自动刮削」从被动转主动的关键 —— 用户放进去的老文件也能被补齐，
   * 不只是新点播的歌。因为要联网且写盘，默认小批量串行，避免风控。
   */
  async backfill(limit = 20): Promise<{ scanned: number; fixed: number; failed: number }> {
    const cfg = loadConfig();
    const files = this.walkAudio(cfg.musicDir, Math.max(limit * 5, 100));

    let scanned = 0;
    let fixed = 0;
    let failed = 0;

    for (const f of files) {
      if (fixed >= limit) break;
      const info = await this.inspect(f);
      if (!info) { failed++; continue; }
      // 已经齐全的跳过
      if (info.title && info.artist && info.hasCover && info.hasLyrics) continue;

      scanned++;
      // 从路径推断：{artist}/{album}/{title}
      const rel = path.relative(cfg.musicDir, f);
      const parts = rel.split(path.sep);
      const base = path.basename(f, path.extname(f));
      const guessArtist = info.artist || (parts.length >= 3 ? parts[parts.length - 3] : '');
      const guessAlbum = info.album || (parts.length >= 2 ? parts[parts.length - 2] : '');
      const guessTitle = info.title || base;

      const r = await this.applyToFile(f, {
        title: guessTitle,
        artist: guessArtist,
        album: guessAlbum,
        platform: 'kw',            // 未知来源时按酷我接口试歌词
        id: '',
        coverUrl: undefined,
      }, { album: guessAlbum });

      if (r.tags.ok) fixed++;
      else failed++;
    }

    logger.info({ scanned, fixed, failed }, '批量刮削完成');
    return { scanned, fixed, failed };
  }

  /** 递归收集音频文件 */
  private walkAudio(dir: string, limit: number): string[] {
    const files: string[] = [];
    const walk = (d: string) => {
      if (files.length >= limit) return;
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (files.length >= limit) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (AUDIO_EXT.test(e.name)) files.push(full);
      }
    };
    walk(dir);
    return files;
  }
}
