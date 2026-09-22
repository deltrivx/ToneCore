import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { SourceLoader } from './loader.js';
import { SearchEngine } from '../search/index.js';
import { RETIRED_PLATFORMS } from '../search/index.js';
import { fetchKwUrl } from '../search/platforms/kw-url.js';
import fs from 'node:fs';
import path from 'node:path';
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
 *
 * 分两档，因为危害程度不同：
 *   strong —— 几乎可以确定「不是用户想听的那首」：翻唱、伴奏、恶搞、DJ。
 *             命中一个就应当把该候选压到原唱之下。
 *   weak   —— 可能是同一首的正常版本（Live、重制、母带），只是偏好更低。
 */
const NOISE_STRONG = [
  '伴奏', 'remix', 'dj', '翻唱', 'cover', '纯音乐', '消音', 'ktv',
  '铃声', '串烧', '改编', '慢摇', '抖音', '恶搞', '搞笑', '鬼畜',
  '奥特曼', '作业版', '堵桥', '喊麦', '土味', '电音', '八音盒',
  '童声', '儿歌', '贝瓦', '合唱', '清唱', 'demo', '试听', '片段',
  '降调', '升调', '变调', '加速版', '减速版',
];

const NOISE_WEAK = [
  'live', '现场', '演奏', '钢琴', '吉他', '口琴', '完整版',
  '女生版', '男声版', '男版', '女版', '另一版', '重制', '新版',
  '修复版', '纪念版', '特别版', 'single version', 'acoustic',
];

/**
 * 计算版本噪音惩罚（越大越该降权）。
 *
 * 实测校准（2026-09-22）：旧版每个词只扣 0.25、上限 0.5，
 * 导致「沐云轩 - 稻香（堵桥版）」与「周杰伦 - 稻香」拉不开差距，
 * 而 kw 平台搜「稻香」的结果里根本没有原唱 —— 于是点歌点到了恶搞版。
 * 现在强噪音直接重罚 1.2，确保原唱（无噪音）稳定胜出。
 */
function noisePenalty(title: string): number {
  const t = title.toLowerCase();
  let penalty = 0;
  for (const w of NOISE_STRONG) if (t.includes(w)) penalty += 1.2;
  for (const w of NOISE_WEAK) if (t.includes(w)) penalty += 0.45;
  // 封顶：即便命中一堆噪音词，也不至于把分数打成负数（那是「淘汰」的语义，另由阈值管）
  return Math.min(penalty, 2.4);
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

    // 与 resolve() 保持同一套打分口径，避免两条路径选出不同的歌
    let score = (ts - 0.35) * 4;

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

  // 门槛：至少要像同一首歌（与 resolve 的 MIN_SCORE 对齐）
  return bestScore >= 2.0 ? best : null;
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
    this.loadTests();
  }

  async reload() { await this.loader.loadAll(); }

  get sourceCount(): number { return this.loader.count; }
  get searchPlatforms(): string[] { return this.search.platforms; }

  /** 已下线平台及原因（供界面说明） */
  get retiredPlatforms(): Record<string, string> { return RETIRED_PLATFORMS; }

  listSources() {
    return this.loader.list().map((s) => ({
      ...s,
      platformCoverage: s.platforms.map((p) => ({ platform: p, scripts: this.loader.countForPlatform(p) })),
    }));
  }

  /** 完整清单：含加载失败的脚本（界面必须能看到它们和失败原因） */
  listAllSources() {
    const health = this.healthSnapshotMap();
    return this.loader.listAll().map((s) => {
      const h = health[s.file] || health[s.name] || null;
      const t = this.testResults[s.file] || null;
      // 停用的脚本不应参与取链计数，界面也把它标灰
      const disabled = s.loadState === 'disabled';
      return {
        ...s,
        disabled,
        // 最近一次测试结论（含逐平台），供界面内联显示与平台徽章着色
        test: t,
        platformCoverage: disabled
          ? []
          : s.platforms.map((p) => ({ platform: p, scripts: this.loader.countForPlatform(p) })),
        healthDetail: h,
      };
    });
  }

  /** 加载失败清单 */
  loadFailures() {
    return this.loader.loadFailures();
  }

  /** 健康度原始快照（key = 脚本名） */
  healthSnapshot() {
    return this.loader.healthSnapshot();
  }

  /**
   * 单脚本测试结果（持久化到 data/source-tests.json）。
   *
   * 为什么要落盘：界面要在「已加载 · 测试结果：正常」处内联显示，
   * 并且**刷新后仍然保留**；平台徽章也要按最近一次结果着色。
   * 只放内存里一刷新就没了，用户体验等于没测过。
   */
  private testFile = path.join(loadConfig().dataDir, 'source-tests.json');
  private testResults: Record<string, { ok: boolean; at: number; ms?: number; error?: string; platforms?: Record<string, boolean> }> = {};

  private loadTests(): void {
    try {
      if (fs.existsSync(this.testFile)) this.testResults = JSON.parse(fs.readFileSync(this.testFile, 'utf8')) || {};
    } catch { /* 读不到就当没有 */ }
  }
  private saveTests(): void {
    try { fs.writeFileSync(this.testFile, JSON.stringify(this.testResults, null, 2)); } catch { /* ignore */ }
  }
  /** 最近一次测试结果（含逐平台结论） */
  testSnapshot(): Record<string, any> { return this.testResults; }

  private healthSnapshotMap(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const h of this.loader.healthSnapshot()) out[h.name] = h;
    return out;
  }

  /**
   * 启用 / 停用音源。
   *
   * 早前实现是「把文件移进 _disabled/」—— 但界面列表只扫 sources/ 目录，
   * 于是**一停用卡片就消失**，用户再也找不到它、也无法重新启用。
   * 现在改为**原地标记**：文件留在 sources/，文件名记入 disabled 清单；
   * 界面照常列出（标灰），点「启用」即可恢复，且停用的源不参与取链。
   */
  async setSourceEnabled(file: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadConfig();
    const safe = path.basename(file);
    const live = path.join(cfg.sourcesDir, safe);

    // 兼容历史：若脚本还在旧的 _disabled/ 目录里，先挪回来再改状态
    const legacy = path.join(cfg.sourcesDir, '..', '_disabled', safe);
    try {
      if (!fs.existsSync(live) && fs.existsSync(legacy)) {
        fs.mkdirSync(cfg.sourcesDir, { recursive: true });
        fs.renameSync(legacy, live);
      }
      if (!fs.existsSync(live)) return { ok: false, error: '脚本不存在' };
      await this.loader.setDisabled(safe, !enabled);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  /** 删除音源：移入 _trash/（可回收，不做硬删） */
  async deleteSource(file: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadConfig();
    const safe = path.basename(file);
    const candidates = [path.join(cfg.sourcesDir, safe), path.join(cfg.sourcesDir, '..', '_disabled', safe)];
    const trash = path.join(cfg.sourcesDir, '..', '_trash');
    try {
      const hit = candidates.find((c) => fs.existsSync(c));
      if (!hit) return { ok: false, error: '脚本不存在' };
      fs.mkdirSync(trash, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(hit, path.join(trash, `${stamp}__${safe}`));
      this.loader.healthTracker.forget(safe);
      this.loader.healthTracker.persist();
      await this.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  /** 写入 / 覆盖音源脚本（须为 .js） */
  async writeSource(filename: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadConfig();
    const safe = path.basename(filename.trim());
    if (!safe.endsWith('.js')) return { ok: false, error: '只接受 .js 脚本' };
    if (!content.trim()) return { ok: false, error: '内容为空' };
    try {
      fs.mkdirSync(cfg.sourcesDir, { recursive: true });
      fs.writeFileSync(path.join(cfg.sourcesDir, safe), content, 'utf8');
      await this.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  /**
   * 单源连通性测试。
   *
   * **重要**：洛雪脚本只实现取直链（action=musicUrl），**不实现 search**。
   * 早期版本让脚本去 search 关键词，脚本抛 `action not support: search`
   * 后挂在运行时的 30s 超时上，导致界面上每个音源都显示「超时」——
   * 那是测法错了，不是音源坏了。
   *
   * 正确测法：宿主先自己搜出候选（搜索是宿主的能力），
   * 再把候选交给**这一个脚本**去取链。取到即通。
   */
  async testSource(file: string, keyword: string, platformOverride?: string): Promise<{
    ok: boolean; songs?: number; sample?: string; error?: string; ms?: number;
    /** 逐平台结论（界面据此给平台徽章着色） */
    platforms?: Record<string, boolean>;
    /** 仅部分平台可用（避免「正常」二字掩盖问题） */
    partial?: boolean;
  }> {
    const metas = this.loader.listAll();
    const meta = metas.find((m) => m.file === file || m.name === file);
    if (!meta) return { ok: false, error: '脚本不在清单里（可能已被删除）' };
    if (meta.loadState === 'failed') {
      return { ok: false, error: '脚本加载失败：' + (meta.loadError || '未知原因') };
    }

    // 不能用 platforms[0] 硬取：kg / mg 的宿主搜索已下线（见 RETIRED_PLATFORMS），
    // 而多数脚本把 kg 排在第一位，于是「测试」会对这些脚本一律报
    // 「kg 平台搜索无结果」—— 但它们在 kw / tx / wy 上其实是好的。
    const usable = meta.platforms.filter((p) => !RETIRED_PLATFORMS[p]);
    const targets = platformOverride ? [platformOverride] : usable;
    const t0 = Date.now();

    // 逐平台跑，记录每个平台的结论 —— 界面据此给平台徽章着色
    const platforms: Record<string, boolean> = {};
    let firstOkSample = '';
    let lastError = '';

    for (const p of targets) {
      try {
        const cands = await this.search.searchPlatform(p, keyword);
        if (!cands.length) { platforms[p] = false; lastError = `${p} 平台搜索无结果`; continue; }
        const url = await this.loader.getUrlFromScript(file, cands[0], loadConfig().quality);
        if (!url) { platforms[p] = false; lastError = `${p} 未能取到直链（源站限流/失效）`; continue; }
        platforms[p] = true;
        if (!firstOkSample) firstOkSample = `${cands[0].title} - ${cands[0].artist} → ${url.quality}`;
      } catch (e) {
        platforms[p] = false;
        lastError = String(e).slice(0, 160);
      }
    }

    const ms = Date.now() - t0;
    const okPlatforms = Object.keys(platforms).filter((p) => platforms[p]);
    const ok = okPlatforms.length > 0;

    // 落盘：界面要在「已加载 · 测试结果：…」内联显示，且刷新后保留
    this.testResults[file] = { ok, at: Date.now(), ms, platforms, error: ok ? undefined : lastError };

    if (!ok) {
      return {
        ok: false, ms, platforms,
        error: lastError || '所有可用平台都未能取到直链',
      };
    }
    return {
      ok: true, songs: okPlatforms.length, ms, platforms,
      sample: firstOkSample,
      /** 部分平台可用时也要说明，避免「正常」二字掩盖问题 */
      partial: okPlatforms.length < targets.length,
    };
  }

  /** 全平台并发搜索 */
  async searchAll(
    keyword: string,
    platforms?: string[],
    type: 'song' | 'artist' | 'album' = 'song',
  ): Promise<Map<string, Song[]>> {
    return this.search.searchAll(keyword, platforms, type);
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
      // 每个平台只取前 6 条：再往后的结果相关性断崖下跌，
      // 放进池子只会增加「取链失败逐个重试」的耗时（曾导致单次点歌 125 秒）。
      for (const s of list.slice(0, 6)) {
        const ts = similarity(s.title, keyword);
        if (ts < 0.35) continue;                       // 标题完全不沾边，淘汰
        const as = artist ? similarity(s.artist, artist) : 0.5;
        // 标题是主导项：改为 (ts - 0.35) * 4，让「完全匹配」与「沾边」拉开距离。
        // 旧写法 ts * 1.8 下，完全匹配与 0.85 部分匹配只差 0.27 分，
        // 噪声惩罚一叠就反超 —— 这正是点到翻唱的直接原因。
        let score = (ts - 0.35) * 4;
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
        noise: Number(x.noise.toFixed(2)),
      })),
    }, '候选池打分完成');

    // 3) 按分数从高到低尝试取链（跨平台），但设**分数下限**保护
    //
    // 为什么需要下限：高分候选（原唱）可能取链失败，若不设限会一路降级到
    // 分数很低的候选（例如别的歌手的翻唱），导致「点错歌」。
    // 宁可返回失败让上层提示，也不要放错歌。
    //
    // 阈值依据（改分后的实测分布）：
    //   标题完全匹配 ts=1     → 基础分 (1-0.35)*4 = 2.60
    //   歌手完全匹配 +1.6     → 原唱合计 4.20；有强噪音则 3.00
    //   标题 0.85 部分匹配    → 基础分 2.00
    //   标题沾边 ts=0.5       → 基础分 0.60（低于任何阈值，必被拦）
    //
    // 无 artist 时也要拦住「恶搞/翻唱」：它们标题完全匹配（2.60）
    // 但带强噪音（-1.2）后落到 1.40。阈值取 2.0 可把原唱（2.60）留下、
    // 把纯噪音版排除；同时保留 0.85 部分匹配（2.00）的容错空间。
    const MIN_SCORE = artist ? 2.0 : 2.0;

    // 单个候选取链的超时上限。
    //
    // 背景：音源脚本在源站不可达时会挂到洛雪运行时的 30s 超时，
    // 若串行试 5 个候选就是 150 秒 —— 用户侧表现是「点歌卡死」。
    // 这里给每个候选设 8s 上限，超时即换下一个，整体最坏 12 个候选 ≈ 96s，
    // 且正常情况下第一个候选几百毫秒就返回。
    const PER_CANDIDATE_TIMEOUT = 8000;

    const tried = new Set<string>();
    let bestRejected: Scored | null = null;

    // 并发上限：串行试取链太慢，改为 3 路并发抢。
    // 谁先成功用谁，但**按分数序**消费结果 —— 高分候选失败了才轮到低分，
    // 避免「低分候选先返回就把高分挤掉」。
    const candidates = all.slice(0, 12).filter((c) => c.score >= MIN_SCORE);
    if (candidates.length === 0 && all.length > 0) bestRejected = all[0];

    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3).filter((c) => {
        const key = `${c.s.platform}:${c.s.id}`;
        if (tried.has(key)) return false;
        tried.add(key);
        return true;
      });
      if (batch.length === 0) continue;

      const results = await Promise.all(batch.map(async (cand) => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), PER_CANDIDATE_TIMEOUT);
        });
        try {
          const url = await Promise.race([this.getUrl(cand.s, q), timeout]);
          return { cand, url };
        } catch {
          return { cand, url: null };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }));

      // 批内按分数序取第一个成功的
      for (const { cand, url } of results) {
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
