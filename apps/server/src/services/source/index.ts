import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { SourceLoader, normalizeSongs } from './loader.js';
import type { Song, SongUrl } from './types.js';

export * from './types.js';
export { SourceLoader } from './loader.js';

/** 标题/歌手相似度（0~1），用于从搜索结果里挑最佳匹配 */
function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/[\s\-_（）()《》·]/g, '');
  const y = b.toLowerCase().replace(/[\s\-_（）()《》·]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // 字符级重合度
  const setY = new Set(y);
  let hit = 0;
  for (const c of x) if (setY.has(c)) hit++;
  return (hit / Math.max(x.length, y.length)) * 0.7;
}

/** 从候选里挑最佳匹配 */
export function pickBest(cands: Song[], title: string, artist?: string): Song | null {
  if (cands.length === 0) return null;
  let best: Song | null = null;
  let bestScore = -1;
  for (const c of cands) {
    const ts = similarity(c.title, title);
    const as = artist ? similarity(c.artist, artist) : 0.5;
    const score = ts * 2 + as;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  // 标题至少得沾边
  return bestScore >= 0.5 ? best : null;
}

/**
 * 音源引擎：多平台并发搜索 → 打分选源 → 取直链。
 */
export class SourceEngine {
  private loader: SourceLoader;

  constructor() {
    const cfg = loadConfig();
    this.loader = new SourceLoader(cfg.sourcesDir);
  }

  reload() { this.loader.loadAll(); }

  get sourceCount(): number { return this.loader.count; }
  listSources() { return this.loader.list(); }

  /** 全平台并发搜索，按平台分组返回 */
  async searchAll(keyword: string, platforms?: string[]): Promise<Map<string, Song[]>> {
    const cfg = loadConfig();
    const use = platforms?.length ? platforms : cfg.platforms;
    const out = new Map<string, Song[]>();

    await Promise.all(use.map(async (p) => {
      try {
        const list = await this.searchPlatform(p, keyword);
        if (list.length) out.set(p, list);
      } catch (e) {
        logger.debug({ platform: p, err: String(e) }, '平台搜索失败');
      }
    }));
    return out;
  }

  /** 指定平台搜索 */
  async searchPlatform(platform: string, keyword: string): Promise<Song[]> {
    const scripts = this.loader.forPlatform(platform);
    const results: Song[] = [];
    for (const s of scripts) {
      try {
        const list = await s.search(platform, keyword, 1);
        if (list.length) { results.push(...list); break; }  // 一个脚本成功即够
      } catch { /* 换下一个脚本 */ }
    }
    return results;
  }

  /**
   * 按歌名+歌手找最佳匹配并取直链（点歌主入口）。
   * 按平台优先级依次尝试，任何一个成功就返回。
   */
  async resolve(keyword: string, artist?: string, quality?: string): Promise<{ song: Song; url: SongUrl } | null> {
    const cfg = loadConfig();
    const q = quality || cfg.quality;
    const groups = await this.searchAll(keyword);

    // 按配置的平台优先级排序
    const ordered = cfg.platforms.filter((p) => groups.has(p));
    for (const p of ordered) {
      const best = pickBest(groups.get(p)!, keyword, artist);
      if (!best) continue;
      const url = await this.getUrl(best, q);
      if (url) {
        logger.info({ platform: p, title: best.title, artist: best.artist, quality: url.quality, source: url.source },
          '音源命中');
        return { song: best, url };
      }
    }
    logger.warn({ keyword, artist }, '全部平台取链失败');
    return null;
  }

  /** 取单曲直链（多脚本依次尝试） */
  async getUrl(song: Song, quality: string): Promise<SongUrl | null> {
    const scripts = this.loader.forPlatform(song.platform);
    for (const s of scripts) {
      try {
        const u = await s.getMusicUrl(song.platform, song, quality);
        if (u?.url) return u;
      } catch { /* 换下一个 */ }
    }
    return null;
  }
}
