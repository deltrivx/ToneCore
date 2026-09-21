import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/** QQ 音乐搜索（公开 soso 接口） */
export async function searchTx(keyword: string, page = 1, limit = 20): Promise<Song[]> {
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp` +
    `?w=${encodeURIComponent(keyword)}&format=json&p=${page}&n=${limit}` +
    `&cr=1&new_json=1&aggr=1&lossless=1&catZhida=1`;

  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' },
  });

  const list = j?.data?.song?.list || [];
  return list.map((x: any) => ({
    platform: 'tx',
    id: String(x.songmid || x.mid || ''),
    title: String(x.songname || x.title || ''),
    artist: (x.singer || []).map((s: any) => s.name).join('/'),
    album: x.albumname ? String(x.albumname) : undefined,
    duration: toSeconds(x.interval),
    coverUrl: x.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${x.albummid}.jpg` : undefined,
    qualities: ['128k', '320k', 'flac'],
    raw: {
      name: x.songname, singer: (x.singer || []).map((s: any) => s.name).join('/'),
      album: x.albumname, songmid: String(x.songmid || x.mid || ''),
      source: 'tx', duration: toSeconds(x.interval),
      albumId: x.albumid, albumName: x.albumname,
      interval: x.interval,
      img: x.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${x.albummid}.jpg` : undefined,
    },
  })).filter((s: Song) => s.id && s.title);
}
