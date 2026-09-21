import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { SourceLoader } from './loader.js';
import { SearchEngine } from '../search/index.js';
import { fetchKwUrl } from '../search/platforms/kw-url.js';
import type { Song, SongUrl } from './types.js';

export * from './types.js';
export { SourceLoader } from './loader.js';

/** 打分后的候选（供跨平台竞争使用） */
interface Scored {
  s: Song;
  score: number;
  ts: number;
  as: number;
  noise: number;
}

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

/**
 * 版本噪音词：命中则降权（点歌场景要原版，不要 remix/伴奏/翻唱）。
 */
const VERSION_NOISE = [
  '伴奏', 'remix', 'dj', 'live', '现场', '翻唱', 'cover', '纯音乐',
  '钢琴', '吉他', '口琴', '演奏', '消音', 'ktv', '铃声', '串烧',
  '改编', '加快', '放慢', '慢摇', '抖音', '完整版', '女生版', '男声版',
  '童声', '合唱', '清唱', 'demo', '试听', '片段', '另一版', '重制',
];

/** 计算版本噪音惩罚（0~1，越大越该降权） */
function noisePenalty(title: string): number {
  const t = title.toLowerCase();
  let hit = 0;
  for (const w of VERSION_NOISE) if (t.includes(w)) hit++;
  // 命中越多惩罚越重，但最多扣一半
  return Math.min(hit * 0.25, 0.5);
}

/**
 * 从候选里挑最佳匹配。
 *
 * 打分要点（点歌场景）：
 *   1. 歌手权重 ≈ 标题（歌手不匹配直接大幅降分，避免「陈奕迅的歌点到翻唱」）
 *   2. 版本噪音词惩罚（伴奏/DJ/翻唱 降权）
 *   3. 标题完全无关则直接淘汰
 */
export function pickBest(cands: Song[], title: string, artist?: string): Song | null {
  if (cands.length === 0) return null;
  let best: Song | null = null;
  let bestScore = -1;

  for (const c of cands) {
    const ts = similarity(c.title, title);
    // 标题完全不沾边 → 直接淘汰
    if (ts < 0.35) continue;

    let score = ts * 1.8;

    if (artist) {
      const as = similarity(c.artist, artist);
      // 歌手不匹配时重罚；匹配时给加成
      if (as >= 0.8) score += 1.6;
      else if (as >= 0.5) score += 0.6;
      else score -= 1.0;                       // 歌手对不上，大概率不是要的那首
    }

    score -= noisePenalty(c.title);            // 版本噪音惩罚

    if (score > bestScore) { bestScore = score; best = c; }
  }

  // 门槛：至少要像同一首歌
  return bestScore >= 1.0 ? best : null;
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

  /**
   * 取直链。
   * 策略：先用「自研直连」（不依赖第三方，最稳），失败再回退音源脚本。
   */
  async getUrl(song: Song, quality: string): Promise<SongUrl | null> {
    // 1) 自研直连（目前支持酷我）
    if (song.platform === 'kw') {
      const builtin = await fetchKwUrl(song, quality);
      if (builtin) return builtin;
    }
    // 2) 回退：洛雪音源脚本（多脚本并行）
    return this.loader.getUrl(song.platform, song, quality);
  }

  /**
   * 按歌名+歌手找最佳匹配并取直链（点歌主入口）。
   *
   * 关键策略：**跨平台统一打分竞争**，而不是「按固定平台顺序取第一个成功的」。
   *
   * 原因（实测）：各平台搜索结果质量差异很大 ——
   *   例如「孤勇者 陈奕迅」：kw 全是翻唱（无原唱），wy/tx 有原唱。
   *   若按平台顺序先试 kw，会命中「暴躁小江 - 孤勇者」。
   * 因此必须把所有平台候选放在一起比，分数高的先取链。
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

    // 1) 汇总所有平台候选，统一打分
    const all: Scored[] = [];
    for (const [p, list] of groups) {
      for (const s of list.slice(0, 8)) {
        const ts = similarity(s.title, keyword);
        if (ts < 0.35) continue;                       // 标题完全不沾边，淘汰
        const as = artist ? similarity(s.artist, artist) : 0.5;
        let score = ts * 1.8;
        if (artist) score += as >= 0.8 ? 1.6 : as >= 0.5 ? 0.6 : -1.2;
        const noise = noisePenalty(s.title);
        score -= noise;
        all.push({ s, score, ts, as, noise });
      }
    }
    if (all.length === 0) {
      logger.warn({ keyword, artist }, '候选池打分后为空');
      return null;
    }

    // 2) 全局排序：分数优先；同分时按平台配置顺序（体现偏好）
    const pref = new Map(cfg.platforms.map((p, i) => [p, i]));
    all.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
      return (pref.get(a.s.platform) ?? 99) - (pref.get(b.s.platform) ?? 99);
    });

    logger.debug({
      keyword, artist,
      top: all.slice(0, 5).map((x) => ({
        p: x.s.platform, t: x.s.title.slice(0, 20), a: x.s.artist.slice(0, 14),
        score: Number(x.score.toFixed(2)), artistSim: Number(x.as.toFixed(2)),
      })),
    }, '候选池打分完成');

    // 3) 按分数从高到低尝试取链（跨平台），但设**分数下限**保护
    //
    // 为什么需要下限：高分候选（原唱）可能取链失败，若不设限会一路降级到
    // 分数很低的候选（例如别的歌手的翻唱），导致「点错歌」。
    // 宁可返回失败让上层提示，也不要放错歌。
    //
    // 阈值依据实测分数分布：
    //   3.4  = 标题完全匹配 + 歌手完全匹配（原唱）
    //   2.88 = 标题匹配 + 歌手匹配，但有版本噪音词
    //   1.8  = 标题匹配 + 歌手部分匹配（含 feat./合唱）
    //   0.6  = 标题匹配但歌手不匹配（翻唱）← 必须拦住
    const MIN_SCORE = artist ? 1.6 : 1.8;

    const tried = new Set<string>();
    let bestRejected: Scored | null = null;

    for (const cand of all.slice(0, 12)) {
      const key = `${cand.s.platform}:${cand.s.id}`;
      if (tried.has(key)) continue;
      tried.add(key);

      if (cand.score < MIN_SCORE) {
        // 分数过低：记录但不再继续降级（后面的只会更差）
        bestRejected = cand;
        break;
      }

      const url = await this.getUrl(cand.s, q);
      if (url) {
        logger.info({
          platform: cand.s.platform, title: cand.s.title, artist: cand.s.artist,
          quality: url.quality, source: url.source, score: Number(cand.score.toFixed(2)),
        }, '音源命中');
        return { song: cand.s, url };
      }
      logger.debug({
        platform: cand.s.platform, title: cand.s.title, artist: cand.s.artist,
        score: Number(cand.score.toFixed(2)),
      }, '该候选取链失败，尝试下一个');
    }

    if (bestRejected) {
      logger.warn({
        keyword, artist,
        rejectedPlatform: bestRejected.s.platform,
        rejectedTitle: bestRejected.s.title,
        rejectedArtist: bestRejected.s.artist,
        rejectedScore: Number(bestRejected.score.toFixed(2)),
        minScore: MIN_SCORE,
      }, '候选分数低于阈值，拒绝降级（避免点错歌）');
    }
    logger.warn({ keyword, artist }, '全部平台取链失败');
    return null;
  }
}
