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

  // ---- 2) 网易云：候选按分排序，逐个试歌词，取**第一个真有歌词的** ----
  //
  // 为什么不是「取最高分那首的歌词」：正版曲目在网易常因版权下架，搜索结果
  // 只剩翻唱；而翻唱版本**多数不带歌词**（实测：稻香/本草纲目 前 3 个候选
  // 歌词全为空，第 4 个才有）。只认最高分就会得出「这首歌没歌词」的假结论。
  const cands = await searchWyList(title, artist, 8);
  for (const c of cands) {
    const lrc = await lyricFromWy(c.id);
    if (lrc) return { lrc, source: 'wy', plain: !/\[\d{2}:\d{2}/.test(lrc) };
  }

  logger.debug({ title, artist, candidates: cands.length }, '未能获取歌词');
  return null;
}

/**
 * 网易云搜索：返回**按匹配度排序的候选列表**（而非单个最佳）。
 *
 * 两个实测坑：
 *   1) 搜索接口**不返回 picUrl**（`album.picUrl` 恒为 null），封面必须另外
 *      调 `api/song/detail?ids=[id]`。
 *   2) 结果里大量是翻唱/魔改版，标题还常带括号后缀（`稻香(深情版)`），
 *      直接取第一条会拿错人。
 */
async function searchWyList(
  title: string,
  artist?: string,
  limit = 8,
): Promise<Array<{ id: string; name: string; artist: string; album?: string }>> {
  const q = encodeURIComponent(`${title} ${artist ?? ''}`.trim());
  const txt = await getText(`https://music.163.com/api/search/get?s=${q}&type=1&limit=${limit}`);
  if (!txt) return [];
  try {
    const j = JSON.parse(txt);
    const list: any[] = j?.result?.songs ?? [];
    const out: Array<{ id: string; name: string; artist: string; album?: string; score: number }> = [];

    for (const s of list) {
      const name = String(s?.name ?? '');
      const arts = Array.isArray(s?.artists) ? s.artists.map((a: any) => a?.name).filter(Boolean).join('/') : '';
      // 剥掉括号后缀再比，否则「稻香(深情版)」与真原唱都是「部分匹配」，分不开
      const ts = similarityLite(stripSuffix(name), title);
      if (ts < 0.5) continue;
      let score = ts * 2;
      if (artist) {
        const as = similarityLite(arts, artist);
        if (as >= 0.8) score += 1.5;
        else if (as >= 0.5) score += 0.5;
        else score -= 1.0;
      }
      if (NOISE_RE.test(name)) score -= 1.2;   // 翻唱/伴奏/DJ 版降权
      out.push({ id: String(s.id), name, artist: arts, album: s?.album?.name || undefined, score });
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return [];
  }
}

/** 取匹配度最高的单个候选项（供封面使用） */
async function searchWy(
  title: string,
  artist?: string,
): Promise<{ id: string; name: string; artist: string; picUrl?: string; album?: string } | null> {
  const cands = await searchWyList(title, artist, 10);
  if (cands.length === 0) return null;
  const best = cands[0];
  return { ...best, picUrl: await coverFromWy(best.id) };
}

/** 版本噪音词（与 source 模块保持同一套口径） */
const NOISE_RE = /伴奏|remix|dj|翻唱|cover|纯音乐|消音|ktv|铃声|串烧|改编|慢摇|抖音|恶搞|搞笑|鬼畜|堵桥|喊麦|土味|电音|八音盒|童声|儿歌|合唱|清唱|demo|试听|片段|降调|升调|变调|加速版|减速版|治愈版|深情版|正式版/i;

/** 剥掉标题里的括号后缀与常见噪声，便于与原曲名比对 */
function stripSuffix(s: string): string {
  return s
    .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')   // 中英文括号内容
    .replace(/\s*[-–—]\s*.*$/, '')                 // 破折号后的说明
    .trim();
}

/**
 * 用 songId 换封面地址。
 *
 * 搜索接口给的 `album.picUrl` 是空的，必须走 detail 接口 —— 这是实测结论，
 * 不是猜的（搜 5 首歌的 picUrl 全为 null，detail 接口全部有值）。
 */
async function coverFromWy(id: string): Promise<string | undefined> {
  const txt = await getText(`https://music.163.com/api/song/detail?ids=%5B${id}%5D`);
  if (!txt) return undefined;
  try {
    const j = JSON.parse(txt);
    const s = j?.songs?.[0];
    const url = s?.album?.picUrl;
    return typeof url === 'string' && url ? url : undefined;
  } catch {
    return undefined;
  }
}

/** 取网易云歌词（LRC 原文，带时间轴） */
async function lyricFromWy(id: string): Promise<string | null> {
  const txt = await getText(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`);
  if (!txt) return null;
  try {
    const j = JSON.parse(txt);
    const lrc = j?.lrc?.lyric;
    if (typeof lrc === 'string' && lrc.trim()) return lrc.trim();
  } catch { /* 非 JSON */ }
  return null;
}

/**
 * 轻量相似度（仅用于本文件内的候选挑选，避免与 source 模块循环依赖）。
 * 规则与 `services/source` 中保持一致：清洗标点后全等 1.0 / 包含 0.85 /
 * 否则按字符交集比例给分。
 */
function similarityLite(a: string, b: string): number {
  const clean = (s: string) => s.toLowerCase().replace(/[\s\-_（）()《》·、,，.。!！?？'"“”]/g, '');
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const setY = new Set(y);
  let hit = 0;
  for (const c of x) if (setY.has(c)) hit++;
  return (hit / Math.max(x.length, y.length)) * 0.7;
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

  // 兜底：借网易云搜出封面地址。
  //
  // 此前这里调的是 `api.lrc.cx/api/cover`，该服务已下线（返回 404），
  // 于是「没有 coverUrl 的歌」永远拿不到封面 —— 这是封面目测缺失的直接原因。
  //
  // 逐个候选试（不只看最高分）：最高分那首可能是无封面的翻唱，
  // 次高分反而有图。实测「孤勇者」就属于这种情况。
  const cands = await searchWyList(title, artist, 6);
  for (const c of cands) {
    const url = await coverFromWy(c.id);
    if (!url) continue;
    const hit = await downloadImage(url);
    if (hit) return hit;
  }
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
