import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/**
 * 酷狗音乐搜索（移动端公开接口）。
 * 需要 mid/dfid 等参数，缺失时由服务端以固定值兜底。
 */
export async function searchKg(keyword: string, page = 1, limit = 20): Promise<Song[]> {
  const url =
    `https://mobilecdn.kugou.com/api/v3/search/song` +
    `?format=json&keyword=${encodeURIComponent(keyword)}` +
    `&page=${page}&pagesize=${limit}&showtype=1`;

  const j = await fetchJson<any>(url, { headers: { Referer: 'https://www.kugou.com/' } });

  const list = j?.data?.info || [];
  return list.map((x: any) => ({
    platform: 'kg',
    id: String(x.hash || x.audio_id || ''),
    title: String(x.songname || ''),
    artist: String(x.singername || ''),
    album: x.album_name ? String(x.album_name) : undefined,
    duration: toSeconds(x.duration),
    raw: {
      name: x.songname, singer: x.singername, album: x.album_name,
      songmid: String(x.hash || ''), hash: x.hash, album_id: x.album_id,
      source: 'kg', duration: toSeconds(x.duration),
      musicId: String(x.audio_id || x.hash || ''),
    },
  })).filter((s: Song) => s.id && s.title);
}
