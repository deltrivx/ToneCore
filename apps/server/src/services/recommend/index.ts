/**
 * 音乐推荐（网易云）。
 *
 * 曲库小的时候，「最近入库 / 专辑 / 歌手」这几个本地维度很快就没什么可推荐了 ——
 * 首页看起来是空的。所以需要**在线**推荐源。
 *
 * 参考飞牛音乐扩展（fnmusic-ext）的网易云接入方案，采用同样的两级降级：
 *   1. netease-daily   网易每日推荐  /api/v3/discovery/recommend/songs
 *   2. netease-charts  网易榜单      /api/toplist + /api/playlist/detail
 *
 * 为什么必须分级：每日推荐是最「新鲜」的源，但它可能不通或被限；
 * 榜单是免登录的公开接口，稳定性高。飞牛的做法是 daily 拿不到就跳级到
 * charts，这里照做 —— 推荐位不该因为一个源挂了就整块空掉。
 *
 * ⚠️ 关于 daily 的一个实测事实：该接口**未登录也能返回 32 首真数据**，
 * 但连续两次请求曲目 ID 完全一致 —— 说明它是全网通用的每日推荐，
 * 而不是个性化推荐。要真正个性化必须带登录态（cookie），本项目
 * 不做账号体系，因此这里拿到的就是通用每日推荐。它依然比固定榜单
 * 新鲜（每天轮换），所以值得作为首选，但**不要向用户宣传成「猜你喜欢」**。
 *
 * ⚠️ 另一条实测约束：飞牛的 musicbox 服务（含真正的登录态与个性化）
 * 只监听 127.0.0.1:8770，从 Unraid（192.168.31.2）实测不可达（HTTP 000）。
 * 所以本项目**不能复用飞牛的服务**，只能照它的方案自己接网易云公开接口。
 *
 * 这份数据只用于**展示与引导**：点某首会走正常的在线播放/入库链路，
 * 不在这里落库。
 */

import { logger } from '../../logger.js';
import { DEFAULT_UA } from '../search/http.js';

export interface RecommendItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  platform: 'wy';
  /** 推荐理由（网易给的推荐语），没有则不展示 */
  reason?: string;
}

export interface RecommendBoard {
  id: string;
  name: string;
  /** 榜单说明（如「刚刚更新」） */
  desc?: string;
  coverUrl?: string;
  items: RecommendItem[];
  /** 这个板块来自哪一级（供前端与排障区分） */
  tier: 'daily' | 'charts';
}

/** 请求超时。推荐是锦上添花，宁可快失败也不要拖住首页。 */
const TIMEOUT_MS = 8000;

async function getJson(url: string, timeout = TIMEOUT_MS): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://music.163.com' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    logger.debug({ url: url.slice(0, 90), err: String(e).slice(0, 100) }, '推荐请求失败');
    return null;
  }
}

/** 把 artists 数组拼成「A/B」 */
function joinArtists(v: any): string {
  const arr = Array.isArray(v) ? v : [];
  const names = arr.map((a: any) => String(a?.name ?? '')).filter(Boolean);
  return names.join('/') || '未知歌手';
}

/**
 * 每日推荐曲目 → 统一结构。
 *
 * 注意这里的字段名与榜单接口**不同**：daily 用 `al`（专辑）与 `ar`（歌手），
 * 而榜单用 `album` / `artists`。两套必须分开解析，不能复用同一个映射函数。
 */
function toDailyItems(songs: any[], reasons: any, limit: number): RecommendItem[] {
  const out: RecommendItem[] = [];
  // 推荐理由按曲目 id 索引，取不到就留空（前端不展示即可）
  const reasonMap = new Map<string, string>();
  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      const id = String(r?.songId ?? '');
      const txt = String(r?.reason ?? '').trim();
      if (id && txt) reasonMap.set(id, txt);
    }
  }

  for (const t of songs || []) {
    const title = String(t?.name ?? '').trim();
    if (!title) continue;
    const id = String(t?.id ?? '');
    if (!id) continue;
    const al = t?.al ?? {};
    out.push({
      id,
      title,
      artist: joinArtists(t?.ar),
      album: al?.name ? String(al.name) : undefined,
      coverUrl: al?.picUrl ? String(al.picUrl) : undefined,
      duration: Number(t?.dt ?? 0) / 1000 || undefined,
      platform: 'wy',
      reason: reasonMap.get(id),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 榜单曲目 → 统一结构（榜单用 album / artists 字段名） */
function toChartItems(tracks: any[], limit: number): RecommendItem[] {
  const out: RecommendItem[] = [];
  for (const t of tracks || []) {
    const title = String(t?.name ?? '').trim();
    if (!title) continue;
    const id = String(t?.id ?? '');
    if (!id) continue;
    const al = t?.album ?? {};
    out.push({
      id,
      title,
      artist: joinArtists(t?.artists),
      album: al?.name ? String(al.name) : undefined,
      // 榜单自带封面，这里直接给原图地址（前端按需展示，不落盘）
      coverUrl: al?.picUrl ? String(al.picUrl) : undefined,
      duration: Number(t?.duration ?? 0) / 1000 || undefined,
      platform: 'wy',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 取网易每日推荐。
 *
 * 实测：未登录也能返回 32 首（通用每日推荐，非个性化）。
 * 失败返回 null，由上层跳级到榜单。
 */
async function fetchDaily(limit: number): Promise<RecommendBoard | null> {
  const j = await getJson('https://music.163.com/api/v3/discovery/recommend/songs');
  const data = j?.data;
  const songs = data?.dailySongs;
  if (!Array.isArray(songs) || songs.length === 0) {
    logger.debug('每日推荐为空，跳级到榜单');
    return null;
  }
  const items = toDailyItems(songs, data?.recommendReasons, limit);
  if (!items.length) return null;
  return {
    id: 'daily',
    name: '每日推荐',
    desc: '网易云每日推荐',
    coverUrl: items.find((x) => x.coverUrl)?.coverUrl,
    items,
    tier: 'daily',
  };
}

/** 榜单清单里的常用榜（取不到清单时的兜底） */
const FALLBACK_BOARDS: Array<{ id: string; name: string }> = [
  { id: '19723756', name: '飙升榜' },
  { id: '3779629', name: '新歌榜' },
  { id: '3778678', name: '热歌榜' },
  { id: '2884035', name: '原创榜' },
];

/**
 * 取榜单列表。
 *
 * 为什么不再硬编码 4 个：实测 /api/toplist 返回 **63 个榜单**
 * （飙升/新歌/热歌/原创/古典/电音/说唱/UK/Billboard……）。
 * 硬编码只给了 4 个，白白浪费了几十个源。这里动态取前若干个，
 * 取不到清单时才回退到内置的那 4 个。
 */
async function fetchBoardList(max: number): Promise<Array<{ id: string; name: string; desc?: string; coverUrl?: string }>> {
  const j = await getJson('https://music.163.com/api/toplist');
  const list = j?.list;
  if (!Array.isArray(list) || list.length === 0) return FALLBACK_BOARDS.slice(0, max);
  return list.slice(0, max).map((b: any) => ({
    id: String(b?.id ?? ''),
    name: String(b?.name ?? '').trim(),
    desc: b?.updateFrequency ? String(b.updateFrequency) : undefined,
    coverUrl: b?.coverImgUrl ? String(b.coverImgUrl) : undefined,
  })).filter((b: { id: string }) => b.id);
}

/**
 * 取推荐板块。
 *
 * 分级：每日推荐 → 榜单。任一级失败都不抛错，只是该级缺席 ——
 * 在线推荐是锦上添花，网络不通不该让首页整体加载失败。
 *
 * @param limit        每个板块最多几首
 * @param maxBoards    最多几个榜单板块
 */
export async function fetchRecommendBoards(limit = 12, maxBoards = 6): Promise<RecommendBoard[]> {
  const boards: RecommendBoard[] = [];

  // ---- 1) 每日推荐 ----
  const daily = await fetchDaily(limit);
  if (daily) boards.push(daily);

  // ---- 2) 榜单兜底 / 补充 ----
  const wanted = await fetchBoardList(Math.max(1, maxBoards - boards.length));
  // 榜单详情逐个取：并发 3 路，避免一次打太多把接口打挂
  const results = await mapLimit(wanted, 3, async (b) => {
    const j = await getJson(`https://music.163.com/api/playlist/detail?id=${b.id}`);
    const r = j?.result;
    if (!r) return null;
    const items = toChartItems(r?.tracks, limit);
    if (!items.length) return null;
    return {
      id: b.id,
      name: String(r?.name || b.name) || b.name,
      desc: b.desc,
      coverUrl: b.coverUrl || items.find((x) => x.coverUrl)?.coverUrl,
      items,
      tier: 'charts' as const,
    };
  });

  for (const r of results) if (r) boards.push(r);
  return boards;
}

/** 带并发上限的 map（避免瞬时打爆上游） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
