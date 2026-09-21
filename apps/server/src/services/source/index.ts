import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { SourceLoader } from './loader.js';
import { SearchEngine } from '../search/index.js';
import type { Song, SongUrl } from './types.js';

export * from './types.js';
export { SourceLoader } from './loader.js';

/** 标题/歌手相似度（0~1），用于从搜索结果里挑最佳匹配 */
function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/[\s\-_（）()《》·、,，.。!！?？]/g, '');
  const y = b.toLowerCase().replace(/[\s\-_（）()《》·、,，.。!！?？]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
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
    // 标题权重更高；同时要求标题不能完全不沾边
    const score = ts * 2 + as;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 1.2 ? best : null;
}

/**
 * 音源引擎：
 *   搜索 → SearchEngine（宿主自研，各平台公开 API）
 *   取链 → SourceLoader（洛雪脚本，action=musicUrl）
 */
export class SourceEngine {
  private loader: SourceLoader;
  private search: SearchEngine;

  constructor() {
    const cfg = loadConfig();
    this.loader = new SourceLoader(cfg.sourcesDir);
    this.search = new SearchEngine();
  }

  async reload() { await this.loader.loadAll(); }

  get sourceCount(): number { return this.loader.count; }
  get searchPlatforms(): string[] { return this.search.platforms; }

  listSources() {
    return this.loader.list().map((s) => ({
      ...s,
      platformCoverage: s.platforms.map((p) => ({ platform: p, scripts: this.loader.countForPlatform(p) })),
    }));
  }

  /** 全平台并发搜索 */
  async searchAll(keyword: string, platforms?: string[]): Promise<Map<string, Song[]>> {
    return this.search.searchAll(keyword, platforms);
  }

  /** 单平台搜索 */
  async searchPlatform(platform: string, keyword: string): Promise<Song[]> {
    return this.search.searchPlatform(platform, keyword);
  }

  /** 取直链 */
  async getUrl(song: Song, quality: string): Promise<SongUrl | null> {
    return this.loader.getUrl(song.platform, song, quality);
  }

  /**
   * 按歌名+歌手找最佳匹配并取直链（点歌主入口）。
   * 按平台优先级依次尝试，任何平台成功即返回。
   */
  async resolve(keyword: string, artist?: string, quality?: string): Promise<{ song: Song; url: SongUrl } | null> {
    const cfg = loadConfig();
    const q = quality || cfg.quality;

    const groups = await this.searchAll(keyword);
    if (groups.size === 0) {
      logger.warn({ keyword, artist }, '所有平台搜索均无结果');
      return null;
    }
    logger.debug({ keyword, hitPlatforms: [...groups.keys()] }, '搜索命中平台');

    const ordered = cfg.platforms.filter((p) => groups.has(p));
    for (const p of ordered) {
      // 该平台必须有可用取链脚本
      if (this.loader.countForPlatform(p) === 0) continue;

      // 按相似度排序候选，逐个尝试（避免最佳匹配恰好取链失败）
      const cands = groups.get(p)!.slice(0, 5)
        .map((s) => ({ s, score: similarity(s.title, keyword) * 2 + (artist ? similarity(s.artist, artist) : 0.5) }))
        .sort((a, b) => b.score - a.score);

      for (const { s } of cands) {
        const url = await this.getUrl(s, q);
        if (url) {
          logger.info({
            platform: p, title: s.title, artist: s.artist,
            quality: url.quality, source: url.source,
          }, '音源命中');
          return { song: s, url };
        }
      }
    }

    logger.warn({ keyword, artist }, '全部平台取链失败');
    return null;
  }
}
