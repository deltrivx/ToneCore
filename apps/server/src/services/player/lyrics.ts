import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * 歌词服务：为前端播放器提供「按歌曲取 LRC」的能力。
 *
 * 三种来源，按可靠性排序：
 *   1) 本地同名 .lrc（最准，用户可能手工校对过）
 *   2) 音频内嵌歌词标签（FLAC Vorbis / ID3 USLT）—— 由刮削阶段写入
 *   3) 在线歌词接口（复用 scraper 的 fetchLyrics）
 *
 * 返回统一结构，前端不必关心来源。
 */

export interface LyricLine {
  /** 起始时间（秒） */
  time: number;
  text: string;
}

export interface LyricResult {
  /** 原始 LRC 文本（可能为空字符串表示纯音乐） */
  lrc: string;
  /** 解析后的时间轴行 */
  lines: LyricLine[];
  /** 是否为纯音乐（无歌词） */
  instrumental: boolean;
  source: 'lrc-file' | 'embedded' | 'online' | 'none';
}

/** 解析 LRC 文本为时间轴行 */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  if (!lrc) return out;

  for (const raw of lrc.split(/\r?\n/)) {
    // 一行可能带多个时间标签：[00:12.34][01:20.00]词
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;

    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    // 只有元信息标签（ar/ti/al/by）的行会解析出空文本，跳过
    if (!text) continue;

    for (const m of stamps) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      // 毫秒段可能是 2 位或 3 位
      const fracRaw = m[3] ?? '';
      const frac = fracRaw ? Number(fracRaw) / Math.pow(10, fracRaw.length) : 0;
      out.push({ time: min * 60 + sec + frac, text });
    }
  }

  return out.sort((a, b) => a.time - b.time);
}

/** 判断是否为纯音乐标记 */
function isInstrumental(lrc: string): boolean {
  return /纯音乐|请欣赏|instrumental|暂无歌词/i.test(lrc) && !/\[\d{1,3}:\d{1,2}/.test(lrc);
}

export class LyricsService {
  /** 内存缓存：同一首歌短时间内多次请求（播放器切歌来回跳）不必反复读盘 */
  private cache = new Map<string, LyricResult>();
  private static MAX_CACHE = 200;

  /**
   * 按曲库相对路径取歌词。
   *
   * relPath 是曲库里的相对路径（与 /stream 一致），
   * 但用户也可能从搜索页直接播在线歌曲，此时 relPath 为空 —— 
   * 那就只能走在线接口。
   */
  async get(relPath: string | undefined, title: string, artist?: string, platform?: string, songId?: string): Promise<LyricResult> {
    const key = relPath || `${title}|${artist ?? ''}|${platform ?? ''}|${songId ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const result = await this.resolve(relPath, title, artist, platform, songId);

    if (this.cache.size >= LyricsService.MAX_CACHE) {
      // 简单 LRU：清掉最早插入的一批，避免无界增长
      const drop = [...this.cache.keys()].slice(0, 50);
      for (const k of drop) this.cache.delete(k);
    }
    this.cache.set(key, result);
    return result;
  }

  private async resolve(
    relPath: string | undefined,
    title: string,
    artist?: string,
    platform?: string,
    songId?: string,
  ): Promise<LyricResult> {
    // ---- 1) 本地同名 .lrc（用户手工校对过的最准） ----
    const local = this.readLocalLrc(relPath);
    if (local !== null) {
      return { lrc: local, lines: parseLrc(local), instrumental: isInstrumental(local), source: 'lrc-file' };
    }

    // ---- 2) 音频内嵌歌词标签（刮削阶段写进去的，本地原曲的时间轴） ----
    //
    // 这一步此前「只在注释里存在」：文档写了三来源，实际只读了同名 .lrc，
    // 于是本地歌一律回落到在线接口 —— 在线按歌名搜索常命中翻唱，
    // 时间轴与本地音频对不上，就是用户说的「歌词严重不匹配、时间错乱」。
    const embedded = await this.readEmbeddedLrc(relPath);
    if (embedded) {
      const lines = parseLrc(embedded);
      if (lines.length) {
        return { lrc: embedded, lines, instrumental: isInstrumental(embedded), source: 'embedded' };
      }
    }

    // ---- 3) 在线歌词接口 ----
    try {
      const { fetchLyrics } = await import('../scraper/lyrics.js');
      const r = await fetchLyrics(title, artist, platform, songId);
      if (r?.lrc) {
        return { lrc: r.lrc, lines: parseLrc(r.lrc), instrumental: isInstrumental(r.lrc), source: 'online' };
      }
    } catch (e) {
      logger.debug({ title, err: String(e).slice(0, 120) }, '在线歌词获取失败');
    }

    return { lrc: '', lines: [], instrumental: false, source: 'none' };
  }

  /** 读取音乐目录下的同名 .lrc；不存在返回 null（与「存在但为空」区分） */
  private readLocalLrc(relPath?: string): string | null {
    if (!relPath) return null;
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    // 相对路径 → 去掉扩展名 + .lrc
    const abs = path.resolve(root, relPath.replace(/\.[^.]+$/, '') + '.lrc');
    // 防目录穿越
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    try {
      if (!fs.existsSync(abs)) return null;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * 读取音频**内嵌**的歌词标签（FLAC Vorbis / ID3 USLT）。
   *
   * 为什么必须有这一步：刮削入库时歌词是写进标签里的（`lyrics: true`），
   * 而音乐目录下**并不会**生成同名 .lrc（实测 11 个 FLAC 只有 1 个 .lrc）。
   * 少了这一步，本地歌取歌词会直接落到在线接口 —— 在线按歌名搜索，
   * 经常命中翻唱/别的版本，时间轴与本地音频完全对不上，
   * 表现就是「歌词严重不匹配、时间错乱」。
   *
   * 优先级排在同名 .lrc 之后（用户手工校对过的应该最准），在线之前。
   */
  private async readEmbeddedLrc(relPath?: string): Promise<string | null> {
    if (!relPath) return null;
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    const abs = path.resolve(root, relPath);
    // 防目录穿越
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    try {
      if (!fs.existsSync(abs)) return null;
      const { parseFile } = await import('music-metadata');
      const md = await parseFile(abs);
      const raw = md?.common?.lyrics;
      const text = Array.isArray(raw) ? raw.join('\n') : (typeof raw === 'string' ? raw : '');
      if (!text.trim()) return null;
      // ⚠️ 刮削阶段可能把「非标准前缀」整套写进来（实测抓到 `[kuwo:064]` 开头、
      // 内容是逐行偏移标记而非 `[mm:ss.xx]` 的形式）。这种文本塞进 parseLrc
      // 会解析出错误时间轴，必须挡住，宁可走在线也不要错词。
      return this.looksLikeLrc(text) ? text : null;
    } catch (e) {
      logger.debug({ err: String(e).slice(0, 120) }, '读取内嵌歌词失败');
      return null;
    }
  }

  /** 是否为「真」LRC：存在至少一行标准时间标签 */
  private looksLikeLrc(text: string): boolean {
    return /\[\d{1,3}:\d{1,2}(?:[:.]\d{1,3})?\]/.test(text);
  }
}
