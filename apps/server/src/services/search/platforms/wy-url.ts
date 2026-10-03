import { DEFAULT_UA } from '../http.js';
import { logger } from '../../../logger.js';
import type { Song, SongUrl } from '../../source/types.js';

/**
 * 自研网易云取链（不依赖第三方音源脚本，也不桥接任何外部服务）。
 *
 * 为什么要有这条通道：
 *   第三方洛雪脚本常年大面积失效（v0.30.0 实测 23 份里 5 份加载失败），
 *   取链能力不能只押在脚本上。酷我已经有了 `fetchKwUrl` 这条自研保底，
 *   网易云作为主力平台（搜索质量最好、曲库最全）却没有 —— 这是缺口。
 *
 * 接口（实测 2026-10-03，免登录）：
 *   GET https://music.163.com/api/song/enhance/player/url?ids=[id]&br=<码率>
 *   返回 {"data":[{"id":..,"url":"http://m701.music.126.net/...","br":320000,"type":"mp3","code":200}]}
 *
 * ⚠️ v1 接口 `/api/song/enhance/player/url/v1?level=exhigh` 实测返回
 *    {"msg":"参数错误","code":400} —— 需要额外的加密参数，故**不用**它。
 */

/**
 * 音质档位 → 网易 br 参数（按想要的顺序尝试）。
 *
 * 实测各档位（同一首歌 1973665667）：
 *   br=128000 → type=mp3  br=128000  ✅
 *   br=192000 → type=mp3  br=192000  ✅
 *   br=320000 → type=mp3  br=320000  ✅
 *   br=999000 → type=mp3  br=320000  ⚠️ 实际只给到 320k！
 *
 * 也就是说**无损在无 VIP 时会被静默降级成 320k**，且响应里 br 会如实反映。
 * 所以这里必须回读响应里的 br/type 来判定真实音质 —— 否则界面会
 * 显示「无损」但实际下载的是 320k mp3，落库后扩展名与内容不符。
 */
function brCandidates(quality: string): number[] {
  switch (quality) {
    case 'master':
    case 'flac24bit':
    case 'flac':
      // 先要无损；拿不到（被降级）时由调用方按实际 br 判定，
      // 不需要在这里重复试低码率 —— 降级响应本身已是有效直链。
      return [999000, 320000];
    case '320k':
      return [320000];
    case '128k':
      return [128000];
    default:
      return [320000];
  }
}

/** 把实际拿到的 br 归一化成本项目的音质标识 */
function actualQuality(br: number, type: string): string {
  // 网易的 flac 在 type 上会体现为 flac；mp3 则按码率归位
  if (/flac/i.test(String(type || ''))) return 'flac';
  if (br >= 320000) return '320k';
  if (br >= 192000) return '320k';
  if (br >= 128000) return '128k';
  return '128k';
}

/** 从网易取链响应里解析出直链条目 */
function parseEntry(j: any): { url: string; br: number; type: string; size: number } | null {
  const data = j?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const it = data[0];
  const url = typeof it?.url === 'string' ? it.url : '';
  if (!/^https?:\/\//.test(url)) return null;
  return {
    url,
    br: Number(it?.br ?? 0) || 0,
    type: String(it?.type ?? ''),
    size: Number(it?.size ?? 0) || 0,
  };
}

/**
 * 尝试用网易官方接口取直链。
 *
 * @param song    搜索结果里的曲目（用其 platform 内 id）
 * @param quality 期望音质
 * @returns 取到则返回（quality 为**实际**音质，可能低于期望）
 */
export async function fetchWyUrl(song: Song, quality: string): Promise<SongUrl | null> {
  if (song.platform !== 'wy') return null;

  const id = String(song.id ?? '').trim();
  // id 必须是纯数字：网易歌曲 id 都是数字，非数字说明这条结果不是网易原生 id
  if (!/^\d+$/.test(id)) return null;

  for (const br of brCandidates(quality)) {
    const t0 = Date.now();
    try {
      const url =
        `https://music.163.com/api/song/enhance/player/url` +
        `?ids=${encodeURIComponent(`[${id}]`)}&br=${br}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://music.163.com' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const e = parseEntry(j);
      if (!e) {
        logger.debug({ id, br, raw: JSON.stringify(j).slice(0, 120) }, '自研网易取链无有效 url');
        continue;
      }

      const actual = actualQuality(e.br, e.type);
      // 想要的没拿到（无损被降级）也要如实记一笔，便于排障「为什么是 320k」
      if (actual !== quality) {
        logger.info(
          { id, requested: quality, actual, br: e.br, type: e.type, title: song.title },
          '自研网易取链：音质低于期望（大概率是无 VIP 被降级）',
        );
      } else {
        logger.info({ id, quality: actual, ms: Date.now() - t0, title: song.title }, '自研网易取链成功');
      }
      return { url: e.url, quality: actual, source: 'builtin:netease' };
    } catch (err) {
      logger.debug({ id, br, err: String(err).slice(0, 100) }, '自研网易取链失败');
    }
  }
  return null;
}
