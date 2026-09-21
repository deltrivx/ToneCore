import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/** 网易云音乐搜索（公开 web 接口） */
export async function searchWy(keyword: string, page = 1, limit = 20): Promise<Song[]> {
  const offset = (page - 1) * limit;
  const url =
    `https://music.163.com/api/search/get/web` +
    `?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;

  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://music.163.com/' },
  });

  const list = j?.result?.songs || [];
  return list.map((x: any) => ({
    platform: 'wy',
    id: String(x.id || ''),
    title: String(x.name || ''),
    artist: (x.artists || []).map((a: any) => a.name).join('/'),
    album: x.album?.name ? String(x.album.name) : undefined,
    duration: toSeconds(x.duration),
    coverUrl: x.album?.picUrl ? String(x.album.picUrl) : undefined,
    qualities: ['128k', '320k', 'flac'],
    raw: {
      name: x.name, singer: (x.artists || []).map((a: any) => a.name).join('/'),
      album: x.album?.name, songmid: String(x.id || ''),
      source: 'wy', duration: toSeconds(x.duration),
      musicId: String(x.id || ''),
      img: x.album?.picUrl,
    },
  })).filter((s: Song) => s.id && s.title);
}
