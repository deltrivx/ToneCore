import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/**
 * 咪咕音乐搜索。
 * 注意：m 站接口已改版返回 HTML，此处使用 pc 站公开搜索接口。
 */
export async function searchMg(keyword: string, page = 1, limit = 20): Promise<Song[]> {
  const url =
    `https://music.migu.cn/v3/api/search/song` +
    `?keyword=${encodeURIComponent(keyword)}&page=${page}&pageSize=${limit}`;

  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://music.migu.cn/v3/search?keyword=' + encodeURIComponent(keyword) },
  });

  const list = j?.data?.list || j?.items || [];
  return list.map((x: any) => ({
    platform: 'mg',
    id: String(x.id ?? x.copyrightId ?? x.songId ?? ''),
    title: String(x.name ?? x.songName ?? ''),
    artist: String(x.singer ?? x.singerName ?? ''),
    album: (x.album ?? x.albumName) ? String(x.album ?? x.albumName) : undefined,
    duration: toSeconds(x.duration ?? x.length),
    coverUrl: (x.cover ?? x.pic) ? String(x.cover ?? x.pic) : undefined,
    raw: {
      name: x.name ?? x.songName, singer: x.singer ?? x.singerName,
      album: x.album ?? x.albumName,
      songmid: String(x.id ?? x.copyrightId ?? x.songId ?? ''),
      source: 'mg', duration: toSeconds(x.duration ?? x.length),
      musicId: String(x.id ?? x.copyrightId ?? x.songId ?? ''),
      copyrightId: x.copyrightId,
    },
  })).filter((s: Song) => s.id && s.title);
}
