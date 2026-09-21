import { logger } from '../../logger.js';
import { DEFAULT_UA } from '../search/http.js';

/**
 * 歌词与封面来源。
 *
 * 策略：优先用平台自带的歌词接口（酷我/酷狗/QQ 都提供公开 LRC），
 * 拿不到再退到通用歌词搜索接口。不依赖任何需要鉴权的服务。
 *
 * 返回的歌词统一成 LRC 文本（带时间轴）—— 播放器普遍认这个格式，
 * 直接写进标签或同名 .lrc 文件都能用。
 */

export interface LyricsResult {
  lrc: string;
  /** 歌词来源，便于排查 */
  source: string;
  /** 是否为纯文本（无时间轴） */
  plain: boolean;
}

/** 从平台响应里抽取 LRC 文本（各家字段名不一致） */
function pickLrc(json: any): string | null {
  if (!json) return null;
  const cands = [
    json?.data?.lrclist && buildLrcFromList(json.data.lrclist),
    json?.lrc,
    json?.data?.lrc,
    json?.data?.lyric,
    json?.lyric,
    json?.data?.content,
    json?.content,
  ];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/** 酷我风格的 lrclist：[{time, lineLyric}] → LRC 文本 */
function buildLrcFromList(list: any): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const lines: string[] = [];
  for (const it of list) {
    const t = Number(it?.time ?? it?.timestamp ?? 0);
    const text = String(it?.lineLyric ?? it?.lyric ?? it?.text ?? '').trim();
    if (!text) continue;
    // 酷我的 time 是「秒.厘秒」，需转 mm:ss.xx
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    lines.push(`[${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(2)}]${text}`);
  }
  return lines.length ? lines.join('\n') : null;
}

/** 简洁 http 文本/JSON 获取（带超时，失败不抛） */
async function getText(url: string, timeout = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, Referer: new URL(url).origin },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    logger.debug({ url: url.slice(0, 90), err: String(e).slice(0, 100) }, '歌词请求失败');
    return null;
  }
}

/**
 * 抓取歌词。
 *
 * 多源依次尝试，任一命中即返回。全部失败返回 null，
 * 上层静默跳过（没有歌词不该让落库失败）。
 */
export async function fetchLyrics(title: string, artist?: string, platform?: string, songId?: string): Promise<LyricsResult | null> {
  const q = encodeURIComponent(`${title} ${artist ?? ''}`.trim());

  // ---- 1) 酷我：有关联 ID 时可用其歌词接口，最准 ----
  if (platform === 'kw' && songId) {
    const rid = String(songId).replace(/^MUSIC_/, '');
    const txt = await getText(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${rid}`);
    if (txt) {
      try {
        const lrc = pickLrc(JSON.parse(txt));
        if (lrc) return { lrc, source: 'kuwo', plain: !/\[\d{2}:\d{2}/.test(lrc) };
      } catch { /* 非 JSON */ }
    }
  }

  // ---- 2) 通用搜索：按关键词找 LRC ----
  const txt = await getText(
    `https://api.lrc.cx/api/search?keyword=${q}`,
    8000,
  ).catch(() => null);
  if (txt) {
    try {
      const j = JSON.parse(txt);
      const list = Array.isArray(j) ? j : (j?.data ?? []);
      for (const it of list.slice(0, 3)) {
        const lrc = typeof it?.lrc === 'string' ? it.lrc : pickLrc(it);
        if (lrc) return { lrc, source: 'lrc.cx', plain: !/\[\d{2}:\d{2}/.test(lrc) };
      }
    } catch { /* 非 JSON */ }
  }

  logger.debug({ title, artist }, '未能获取歌词');
  return null;
}

/**
 * 抓取封面图。
 *
 * 优先直接用平台搜索结果里给的 coverUrl（最省事也最准），
 * 没有才退回按关键词搜图。返回 null 表示没找到，上层跳过。
 */
export async function fetchCover(
  coverUrl?: string,
  title?: string,
  artist?: string,
): Promise<{ data: Buffer; mime: string } | null> {
  if (coverUrl) {
    const hit = await downloadImage(coverUrl);
    if (hit) return hit;
  }
  if (!title) return null;

  const q = encodeURIComponent(`${title} ${artist ?? ''}`.trim());
  const txt = await getText(`https://api.lrc.cx/api/cover?keyword=${q}`);
  if (!txt) return null;
  try {
    const j = JSON.parse(txt);
    const url = j?.url ?? j?.data?.url ?? (Array.isArray(j) ? j[0]?.url : null);
    if (typeof url === 'string') return await downloadImage(url);
  } catch { /* 非 JSON */ }
  return null;
}

/** 下载图片并校验确实是图片（防止把 HTML 错误页当封面写进去） */
async function downloadImage(url: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    if (!/^https?:\/\//.test(url)) return null;
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0) return null;

    // 魔数校验：只接受真正的图片
    const isJpg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8;
    const isPng = data.length > 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const isWebp = data.length > 12 && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isJpg && !isPng && !isWebp) {
      logger.debug({ url: url.slice(0, 90), mime, size: data.length }, '封面不是图片，丢弃');
      return null;
    }
    // 过大的图不嵌入（避免标签膨胀），5MB 以上丢弃
    if (data.length > 5 * 1024 * 1024) {
      logger.debug({ url: url.slice(0, 90), size: data.length }, '封面过大，丢弃');
      return null;
    }

    const realMime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
    return { data, mime: realMime };
  } catch (e) {
    logger.debug({ url: url.slice(0, 90), err: String(e).slice(0, 100) }, '封面下载失败');
    return null;
  }
}
