import { DEFAULT_UA, toSeconds } from '../http.js';
import { logger } from '../../../logger.js';
import type { Song } from '../../source/types.js';

/**
 * 酷我音乐搜索。
 *
 * 实测可用的接口是 `search.kuwo.cn/r.s`（返回非标准 JSON，需宽松解析）。
 * 关键坑位：
 *   1. 返回体含单引号/尾逗号/HTML 实体 → 必须宽松解析 + 实体解码
 *   2. MUSICRID 形如 `MUSIC_51685512` → 取链时需保留/剥离视脚本而定，
 *      这里统一保存纯净 rid，并把原值放在 raw 里
 */

/** HTML 实体解码（酷我返回 &nbsp; &amp; 等） */
function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 宽松 JSON 解析：兼容 JSONP / 单引号 / 尾逗号 */
export function looseParse(text: string): any | null {
  let t = String(text || '').trim();
  const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(t);
  if (m) t = m[1];
  try { return JSON.parse(t); } catch { /* 继续尝试 */ }
  try {
    const fixed = t
      .replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

/**
 * 检索维度 → 酷我 `ft` 参数。
 *   song → music（默认，按曲名）
 *   artist → artist（按歌手，返回该歌手曲目）
 *   album → album（按专辑）
 */
const KW_FT: Record<string, string> = { song: 'music', artist: 'artist', album: 'album' };

export async function searchKw(
  keyword: string,
  page = 1,
  limit = 20,
  type: 'song' | 'artist' | 'album' = 'song',
): Promise<Song[]> {
  const pn = Math.max(0, page - 1);
  const ft = KW_FT[type] || 'music';
  const url =
    `https://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}` +
    `&ft=${ft}&itemset=web_2013&client=kt&pn=${pn}&rn=${limit}` +
    `&rformat=json&encoding=utf8`;

  let text = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://www.kuwo.cn/' },
      signal: AbortSignal.timeout(12000),
    });
    text = await res.text();
  } catch (e) {
    logger.debug({ err: String(e).slice(0, 100) }, '酷我搜索请求失败');
    return [];
  }

  const j = looseParse(text);
  const list: any[] = j?.abslist || [];
  if (list.length === 0) return [];

  return list.map((x) => {
    const rawRid = String(x.MUSICRID || '');
    const rid = rawRid.replace(/^MUSIC_/, '');
    const duration = toSeconds(Number(x.DURATION) > 0 ? Number(x.DURATION) : undefined);
    return {
      platform: 'kw',
      id: rid,
      title: decodeEntities(x.SONGNAME),
      artist: decodeEntities(x.ARTIST),
      album: x.ALBUM ? decodeEntities(x.ALBUM) : undefined,
      duration,
      qualities: ['128k', '320k', 'flac'],
      raw: {
        // 兼容不同音源脚本对字段名的预期
        name: decodeEntities(x.SONGNAME),
        singer: decodeEntities(x.ARTIST),
        album: x.ALBUM ? decodeEntities(x.ALBUM) : '',
        songmid: rid,
        musicId: rid,
        rid,
        id: rid,
        MUSICRID: rawRid,
        source: 'kw',
        duration,
        interval: duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '',
      },
    } as Song;
  }).filter((s) => s.id && s.title);
}
