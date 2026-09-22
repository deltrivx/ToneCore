import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';

/**
 * 检索维度 → QQ soso 的 `t` 参数。
 *   0 = 单曲（默认）/ 2 = 歌手 / 3 = 专辑；
 * 歌手与专辑维度返回 al/album 结构，需要转成曲目列表的形态。
 */
const TX_T: Record<string, number> = { song: 0, artist: 2, album: 3 };

/** QQ 音乐搜索（公开 soso 接口） */
export async function searchTx(
  keyword: string,
  page = 1,
  limit = 20,
  type: 'song' | 'artist' | 'album' = 'song',
): Promise<Song[]> {
  const t = TX_T[type] ?? 0;
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp` +
    `?w=${encodeURIComponent(keyword)}&format=json&p=${page}&n=${limit}&t=${t}` +
    `&cr=1&new_json=1&aggr=1&lossless=1&catZhida=1`;

  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' },
  });

  const list = j?.data?.song?.list || [];
  const songs = list.map((x: any) => ({
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
  })).filter((s: Song) => s.id && s.title) as Song[];

  if (songs.length) return songs;

  // 歌手 / 专辑维度：soso 走不同字段，退化时至少不要空手而归。
  // 专辑维度可由专辑 id 直接取曲目；歌手维度用歌手名再搜一次单曲。
  if (type === 'album') {
    const albumMid = j?.data?.album?.list?.[0]?.albumMid;
    if (albumMid) return searchTxAlbumSongs(albumMid, limit);
  }
  if (type === 'artist' && keyword) {
    return searchTx(keyword, 1, limit, 'song');
  }
  return [];
}

/** 由专辑 mid 取该专辑曲目（soso 专辑聚合） */
async function searchTxAlbumSongs(albumMid: string, limit: number): Promise<Song[]> {
  const url =
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg` +
    `?albummid=${encodeURIComponent(albumMid)}&format=json&newsong=1`;
  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' },
  });
  const list: any[] = j?.data?.list || [];
  return list.slice(0, limit).map((x: any) => ({
    platform: 'tx',
    id: String(x.songmid || ''),
    title: String(x.songname || ''),
    artist: (x.singer || []).map((s: any) => s.name).join('/'),
    album: j?.data?.albumName ? String(j.data.albumName) : undefined,
    duration: toSeconds(x.interval),
    coverUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined,
    qualities: ['128k', '320k', 'flac'],
    raw: {
      name: x.songname, singer: (x.singer || []).map((s: any) => s.name).join('/'),
      album: j?.data?.albumName, songmid: String(x.songmid || ''),
      source: 'tx', duration: toSeconds(x.interval),
      interval: x.interval,
      img: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined,
    },
  })).filter((s: Song) => s.id && s.title);
}
