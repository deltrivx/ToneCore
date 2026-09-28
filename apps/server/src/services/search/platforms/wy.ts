import { fetchJson, toSeconds } from '../http.js';
import type { Song } from '../../source/types.js';
import { logger } from '../../../logger.js';

/**
 * 检索维度 → 网易 `type` 参数。
 *   1 = 单曲 / 100 = 歌手 / 10 = 专辑。
 * 歌手与专辑维度返回的结构不同：歌手是 { artists:[{id}] }，需要再拉其热门曲；
 * 专辑是 { albums:[{id}] }，需要拉专辑详情里的曲目。
 */
const WY_TYPE: Record<string, number> = { song: 1, artist: 100, album: 10 };

/** 网易云音乐搜索（公开 web 接口） */
export async function searchWy(
  keyword: string,
  page = 1,
  limit = 20,
  type: 'song' | 'artist' | 'album' = 'song',
): Promise<Song[]> {
  // 歌手 / 专辑维度先搜出实体，再取其曲目，所以此处必须走 type=1 才能拿到歌曲结构
  if (type !== 'song') return searchWyEntity(keyword, type, limit);

  const offset = (page - 1) * limit;
  const url =
    `https://music.163.com/api/search/get/web` +
    `?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;

  const j = await fetchJson<any>(url, {
    headers: { Referer: 'https://music.163.com/' },
  });

  const list: any[] = j?.result?.songs || [];
  const songs: Song[] = list.map((x: any) => ({
    platform: 'wy',
    id: String(x.id || ''),
    title: String(x.name || ''),
    artist: (x.artists || []).map((a: any) => a.name).join('/'),
    album: x.album?.name ? String(x.album.name) : undefined,
    duration: toSeconds(x.duration),
    // ⚠️ 实测：搜索接口返回的 album 里**只有 picId，没有 picUrl**
    // （字段实测为 ['artist','copyrightId','id','mark','name','picId',...]）。
    // 所以这里恒为 undefined —— 在线搜索结果一直没封面，
    // 真正的封面要靠下面 fillWyCovers() 批量补。
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

  await fillWyCovers(songs);
  return songs;
}

/**
 * 批量补齐网易封面。
 *
 * 搜索接口不给 picUrl（只有 picId），要再调一次 `song/detail` 才能拿到真地址。
 * 一次批量请求拿全部，避免逐首请求把搜索拖慢。
 *
 * ⚠️ 失败必须静默：封面只是锦上添花，补不到不该让搜索整体失败。
 */
async function fillWyCovers(songs: Song[]): Promise<void> {
  const missing = songs.filter((s) => !s.coverUrl && s.id);
  if (!missing.length) return;
  try {
    const ids = encodeURIComponent('[' + missing.map((s) => s.id).join(',') + ']');
    const j = await fetchJson<any>(
      `https://music.163.com/api/song/detail?ids=${ids}`,
      { headers: { Referer: 'https://music.163.com/' } },
    );
    const picById = new Map<string, string>();
    for (const s of j?.songs || []) {
      const pic = s?.album?.picUrl;
      if (pic) picById.set(String(s.id), String(pic));
    }
    for (const s of missing) {
      const pic = picById.get(s.id);
      if (!pic) continue;
      s.coverUrl = pic;
      // raw.img 也补上：洛雪音源脚本按这个字段取封面
      if (s.raw) (s.raw as any).img = pic;
    }
  } catch (e) {
    logger.debug({ err: String(e).slice(0, 120) }, '网易封面补全失败（不影响搜索结果）');
  }
}

/**
 * 歌手 / 专辑维度的检索：先搜出实体（歌手 id / 专辑 id），再取该实体的曲目列表。
 * 这样「按歌手入库」「按专辑入库」得到的是完整曲目，而不是一首同名歌。
 */
async function searchWyEntity(
  keyword: string,
  type: 'artist' | 'album',
  limit: number,
): Promise<Song[]> {
  const kind = WY_TYPE[type];
  const sk = await fetchJson<any>(
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=${kind}&limit=1`,
    { headers: { Referer: 'https://music.163.com/' } },
  );

  const entity = type === 'artist' ? sk?.result?.artists?.[0] : sk?.result?.albums?.[0];
  if (!entity?.id) return [];

  // 歌手 → 热门歌曲；专辑 → 专辑曲目
  const api = type === 'artist'
    ? `https://music.163.com/api/artist/top/song?id=${entity.id}`
    : `https://music.163.com/api/album/${entity.id}`;

  const j = await fetchJson<any>(api, { headers: { Referer: 'https://music.163.com/' } });
  const list: any[] = type === 'artist'
    ? (j?.songs || [])
    : (j?.album?.songs || j?.songs || []);

  return list.slice(0, limit).map((x: any) => {
    const artists = (x.ar || x.artists || []).map((a: any) => a.name).join('/');
    const album = x.al?.name || x.album?.name;
    const dur = toSeconds(x.dt || x.duration);
    return {
      platform: 'wy',
      id: String(x.id || ''),
      title: String(x.name || ''),
      artist: artists,
      album: album ? String(album) : undefined,
      duration: dur,
      coverUrl: x.al?.picUrl ? String(x.al.picUrl) : undefined,
      qualities: ['128k', '320k', 'flac'],
      raw: {
        name: x.name, singer: artists, album,
        songmid: String(x.id || ''), source: 'wy',
        duration: dur, musicId: String(x.id || ''),
        img: x.al?.picUrl,
      },
    } as Song;
  }).filter((s: Song) => s.id && s.title);
}
