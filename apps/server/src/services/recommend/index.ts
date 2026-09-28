/**
 * 音乐推荐（在线榜单）。
 *
 * 曲库小的时候，「最近入库 / 专辑 / 歌手」这几个本地维度很快就没什么可推荐了 ——
 * 首页看起来是空的。所以需要**在线**推荐源。
 *
 * 取网易云公开榜单接口（无需鉴权，实测可达）：
 *   /api/toplist          —— 榜单清单
 *   /api/playlist/detail  —— 榜单内曲目（自带封面）
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
}

export interface RecommendBoard {
  id: string;
  name: string;
  coverUrl?: string;
  items: RecommendItem[];
}

/** 常用的几个榜单（id 为网易云公开榜单 id） */
const BOARDS: Array<{ id: string; name: string }> = [
  { id: '3778678', name: '热歌榜' },
  { id: '3779629', name: '新歌榜' },
  { id: '2884035', name: '原创歌曲榜' },
  { id: '19723756', name: '飙升榜' },
];

async function getJson(url: string, timeout = 8000): Promise<any | null> {
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

function toItems(tracks: any[], limit: number): RecommendItem[] {
  const out: RecommendItem[] = [];
  for (const t of tracks || []) {
    const title = String(t?.name ?? '').trim();
    if (!title) continue;
    const artists = Array.isArray(t?.artists) ? t.artists : [];
    const artist = artists.map((a: any) => String(a?.name ?? '')).filter(Boolean).join('/');
    const al = t?.album ?? {};
    out.push({
      id: String(t?.id ?? ''),
      title,
      artist: artist || '未知歌手',
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
 * 取推荐歌单（榜单）。
 *
 * 失败时**返回空数组而不是抛错** —— 在线推荐只是首页的锦上添花，
 * 网络不通不该让首页整体加载失败。
 */
export async function fetchRecommendBoards(limit = 12): Promise<RecommendBoard[]> {
  const boards: RecommendBoard[] = [];

  for (const b of BOARDS) {
    const j = await getJson(`https://music.163.com/api/playlist/detail?id=${b.id}`);
    const r = j?.result;
    if (!r) continue;
    const items = toItems(r?.tracks, limit);
    if (!items.length) continue;
    boards.push({
      id: b.id,
      name: String(r?.name || b.name),
      coverUrl: items.find((x) => x.coverUrl)?.coverUrl,
      items,
    });
  }

  return boards;
}
