import { fetchJson, randomHex, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/**
 * 酷我音乐搜索。
 * 公开接口需带 Referer + 随机 reqid（服务端不强校验签名）。
 */
export async function searchKw(keyword: string, page = 1, limit = 20): Promise<Song[]> {
  const url =
    `http://www.kuwo.cn/api/www/search/searchMusicBykeyWord` +
    `?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}` +
    `&httpsStatus=1&reqId=${randomHex()}`;

  const j = await fetchJson<any>(url, {
    headers: {
      Referer: 'http://www.kuwo.cn/search/list?key=' + encodeURIComponent(keyword),
      csrf: randomHex(),
      Cookie: 'kw_token=AAAA',
    },
  });

  const list = j?.data?.list || [];
  return list.map((x: any) => ({
    platform: 'kw',
    id: String(x.rid || x.musicrid || ''),
    title: String(x.name || ''),
    artist: String(x.artist || ''),
    album: x.album ? String(x.album) : undefined,
    duration: toSeconds(x.duration),
    coverUrl: x.pic ? String(x.pic) : undefined,
    qualities: Array.isArray(x.types) ? x.types.map((t: any) => t.type) : undefined,
    raw: {
      name: x.name, singer: x.artist, album: x.album,
      songmid: String(x.rid || x.musicrid || ''),
      source: 'kw', duration: toSeconds(x.duration),
      img: x.pic, musicId: String(x.rid || x.musicrid || ''),
    },
  })).filter((s: Song) => s.id && s.title);
}
