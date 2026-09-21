import { DEFAULT_UA, randomHex } from '../http.js';
import { logger } from '../../../logger.js';
import type { Song, SongUrl } from '../../source/types.js';

/**
 * 自研酷我取链（不依赖第三方音源脚本）。
 *
 * 原理：酷我 antiserver / 移动端接口可免签名换取真实音频直链。
 *   - antiserver: 返回纯文本 URL（不是 JSON）
 *   - 移动端 mobi: 返回 JSON，含 url 字段
 *
 * 意义：当第三方音源脚本大面积失效时，这条通道是保底能力。
 */

/** 从响应文本里提取音频直链（兼容纯文本 / JSON） */
export function extractAudioUrl(text: string): string | null {
  const t = String(text || '').trim();
  if (/^https?:\/\//.test(t)) return t;                 // 纯文本 URL
  try {
    const j = JSON.parse(t);
    for (const k of ['url', 'data', 'musicUrl', 'playUrl']) {
      const v = j?.[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
      if (v && typeof v === 'object') {
        for (const kk of ['url', 'playUrl']) {
          const vv = v[kk];
          if (typeof vv === 'string' && /^https?:\/\//.test(vv)) return vv;
        }
      }
    }
  } catch { /* 非 JSON */ }
  const m = /(https?:\/\/[^\s"']+)/.exec(t);
  return m ? m[1] : null;
}

/**
 * 音质 → 酷我 format 参数。
 *
 * 实测（2026-09-21）：
 *   ✅ format=mp3 / aac / wma   → 返回真实直链
 *   ❌ format=flac              → "refuse request!"
 *   ❌ format=320kmp3/128kmp3   → "res not found"（酷我不认码率前缀）
 *
 * 因此按「想要无损先试 flac，被拒自动降级 mp3」的顺序返回候选。
 */
function qualityCandidates(quality: string): string[] {
  switch (quality) {
    case 'master':
    case 'flac24bit':
    case 'flac':
      return ['flac', 'mp3', 'aac'];
    case '320k':
      return ['mp3', 'aac'];
    default:
      return ['mp3', 'aac'];
  }
}

/**
 * 尝试用酷我官方接口取直链。
 * 依次尝试多个端点，任一成功即返回。
 */
export async function fetchKwUrl(song: Song, quality: string): Promise<SongUrl | null> {
  const rid = String((song.raw as any)?.rid ?? song.id ?? '').replace(/^MUSIC_/, '');
  if (!rid) return null;

  const fmts = qualityCandidates(quality);

  for (const fmt of fmts) {
    const t0 = Date.now();
    try {
      const url =
        `https://antiserver.kuwo.cn/anti.s?type=convert_url` +
        `&format=${fmt}&response=url&rid=MUSIC_${rid}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://www.kuwo.cn/' },
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      const audio = extractAudioUrl(text);
      if (audio) {
        // 实际音质以请求成功的 format 为准
        const actual = fmt;
        logger.info(
          { endpoint: 'antiserver', rid, requested: quality, actual, ms: Date.now() - t0, title: song.title },
          '自研取链成功',
        );
        return { url: audio, quality: actual, source: 'builtin:kuwo' };
      }
      logger.debug({ rid, fmt, head: text.slice(0, 60) }, '自研取链无 url');
    } catch (e) {
      logger.debug({ rid, fmt, err: String(e).slice(0, 80) }, '自研取链失败');
    }
  }
  return null;
}
