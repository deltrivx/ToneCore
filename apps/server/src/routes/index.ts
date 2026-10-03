import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig, lockedByEnv } from '../config.js';
import { VERSION } from '../version.js';
import { logger } from '../logger.js';
import type { SourceEngine } from '../services/source/index.js';
import type { Downloader } from '../services/download/index.js';
import type { Library } from '../services/library/index.js';
import type { Scraper } from '../services/scraper/index.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { PlayerService, QueueItem, RepeatMode } from '../services/player/index.js';
import type { LyricsService } from '../services/player/lyrics.js';
import type { AuthService } from '../services/auth/index.js';
import type { NeteaseClient } from '../services/netease/client.js';
import { registerSongLoftRoutes } from './songloft.js';
import { registerSubsonicRoutes } from './subsonic.js';

export interface Deps {
  engine: SourceEngine;
  downloader: Downloader;
  lib: Library;
  /** 账号认证与令牌（SongLoft 兼容层依赖） */
  auth: AuthService;
  scraper: Scraper;
  orchestrator: Orchestrator;
  player: PlayerService;
  lyrics: LyricsService;
  /** 网易云客户端（eapi，带登录态：个人歌单 / 每日推荐 / 取链） */
  netease: NeteaseClient;
  /** 对外访问地址（拼绝对直链用） */
  publicBase: () => string;
}

/**
 * 把前端传来的歌曲对象归一成队列项。
 *
 * 前端可能送两种形态：搜索结果（有 platform/songId）或曲库条目（有 filePath）。
 * 这里统一补齐 uid / origin，避免这些判断散落到播放器各处。
 */
let routeUid = 0;
function normalizeQueueItem(s: any, _i: number): QueueItem {
  const filePath = s.filePath ? String(s.filePath) : undefined;
  return {
    uid: String(s.uid || `r${Date.now().toString(36)}${(routeUid++).toString(36)}`),
    title: String(s.title || ''),
    artist: String(s.artist || ''),
    album: s.album ? String(s.album) : undefined,
    platform: String(s.platform || 'kw'),
    songId: String(s.songId ?? s.id ?? ''),
    filePath,
    origin: filePath ? 'local' : 'remote',
    duration: Number(s.duration) || undefined,
    // 本地封面文件名必须保留：前端按 /cover/<name> 拼地址，
    // 丢掉它本地歌在底部播放条上就没有专辑封面。
    cover: s.cover ? String(s.cover) : undefined,
    coverUrl: s.coverUrl ? String(s.coverUrl) : undefined,
  };
}

export async function registerRoutes(app: FastifyInstance, d: Deps) {
  // ---------- SongLoft 兼容层（/api/v1/*）：供外部设备按 SongLoft 方式连接 ----------
  await registerSongLoftRoutes(app, d);

  // ---------- Subsonic 兼容层（/rest/*）：自托管音乐事实标准，箭头音乐/Feishin/Sonixd 等可直接连 ----------
  await registerSubsonicRoutes(app, d);

  // ---------- 健康检查 ----------
  app.get('/api/health', async () => ({
    ok: true,
    version: VERSION,
    sources: d.engine.sourceCount,
    library: d.lib.count(),
    queue: d.downloader.status(),
  }));

  // ---------- 配置 ----------
  app.get('/api/config', async () => ({ ...loadConfig(), _lockedByEnv: lockedByEnv() }));
  app.post('/api/config', async (req) => ({ ok: true, config: saveConfig(req.body as any) }));

  // ---------- 曲库 ----------
  app.get('/api/library', async (req) => {
    const q = req.query as any;
    const limit = Math.min(Math.max(1, Number(q.limit) || 50), 500);
    const offset = Math.max(0, Number(q.offset) || 0);
    const keyword = String(q.keyword || '').trim();
    return {
      total: keyword ? d.lib.countSearch(keyword) : d.lib.count(),
      songs: d.lib.search(keyword, limit, offset),
      keyword,
    };
  });
  app.post('/api/library/scan', async () => d.lib.scan());

  // 磁盘上已被外部删除、但索引里还残留的曲目（只读检查，不改数据）
  app.get('/api/library/missing', async () => {
    const gone = d.lib.missingSongs();
    return { ok: true, missing: gone.length, songs: gone };
  });

  // 清理这些残留条目（连带清出歌单里的失效曲目）
  app.post('/api/library/prune', async () => {
    const r = d.lib.pruneMissing();
    return { ...r, message: r.removed ? `已清理 ${r.removed} 首失效曲目` : '没有失效曲目' };
  });

  // 删除曲库条目。
  // hard=true → 彻底删除（直接 unlink，不可恢复）；默认移入回收站。
  // ⚠️ 硬删不可逆，前端必须二次确认后才允许带 hard。
  app.post('/api/library/delete', async (req) => {
    const b = (req.body || {}) as any;
    const filePath = String(b.filePath || '');
    if (!filePath) return { ok: false, error: '缺少 filePath' };
    return d.lib.remove(filePath, b.hard === true);
  });

  // 曲库统计（供界面概览）
  app.get('/api/library/stats', async () => d.lib.stats());

  // ---------- 音源 ----------
  app.get('/api/sources', async () => ({ count: d.engine.sourceCount, sources: d.engine.listSources() }));
  // 音源完整清单（含加载失败项与原因）
  app.get('/api/sources/all', async () => ({
    count: d.engine.sourceCount,
    sources: d.engine.listAllSources(),
    failures: d.engine.loadFailures().length,
  }));

  // 音源健康度快照
  app.get('/api/sources/health', async () => ({
    health: d.engine.healthSnapshot(),
    failures: d.engine.loadFailures(),
  }));

  // 启用 / 停用音源（停用即移入 _disabled/）
  app.post('/api/sources/toggle', async (req) => {
    const b = (req.body || {}) as any;
    const file = String(b.file || '');
    const enabled = b.enabled !== false;
    if (!file) return { ok: false, error: '缺少 file' };
    const r = await d.engine.setSourceEnabled(file, enabled);
    return { ok: r.ok, error: r.error ?? null };
  });

  // 删除音源（移入 _trash/，可回收）
  app.post('/api/sources/delete', async (req) => {
    const b = (req.body || {}) as any;
    const file = String(b.file || '');
    if (!file) return { ok: false, error: '缺少 file' };
    const r = await d.engine.deleteSource(file);
    return { ok: r.ok, error: r.error ?? null };
  });

  // 重命名 / 覆盖写入音源脚本
  app.post('/api/sources/upload', async (req) => {
    const b = (req.body || {}) as any;
    const filename = String(b.filename || '').trim();
    const content = String(b.content || '');
    if (!filename || !content) return { ok: false, error: '缺少 filename 或 content' };
    const r = await d.engine.writeSource(filename, content);
    return { ok: r.ok, error: r.error ?? null };
  });

  // 单源连通性测试（真打一次搜索，返回结果或具体失败原因）
  app.post('/api/sources/test', async (req) => {
    const b = (req.body || {}) as any;
    const file = String(b.file || '');
    const keyword = String(b.keyword || '测试');
    if (!file) return { ok: false, error: '缺少 file' };
    return d.engine.testSource(file, keyword);
  });

  app.post('/api/sources/reload', async () => {
    await d.engine.reload();
    return { ok: true, count: d.engine.sourceCount };
  });

  // ---------- 搜索 ----------
  app.get('/api/search', async (req) => {
    const q = req.query as any;
    const keyword = String(q.keyword || '').trim();
    if (!keyword) return { ok: false, error: '缺少 keyword' };
    // 检索维度：song（默认）/ artist / album —— 供「按歌手、按专辑入库」
    const raw = String(q.type || 'song');
    const type = (['song', 'artist', 'album'].includes(raw) ? raw : 'song') as 'song' | 'artist' | 'album';
    const groups = await d.engine.searchAll(
      keyword,
      q.platforms ? String(q.platforms).split(',') : undefined,
      type,
    );
    return {
      ok: true, keyword, type,
      platforms: Object.fromEntries([...groups].map(([k, v]) => [k, v.slice(0, 20)])),
      /** 已下线的平台（界面可据此说明为什么看不到） */
      retired: d.engine.retiredPlatforms,
    };
  });

  // ---------- 播放器（SongLoft 契约） ----------
  //
  // 队列与播放状态都放在服务端：<audio> 没有播放列表概念，
  // 状态放前端的话刷新即丢，多设备也无法同步。

  /** 当前播放器全量状态（前端轮询 / 首屏拉取） */
  app.get('/api/player', async () => d.player.snapshot());

  /** 用一组搜索结果替换队列并定位播放 */
  app.post('/api/player/queue', async (req) => {
    const b = (req.body || {}) as any;
    const songs = Array.isArray(b.songs) ? b.songs : [];
    if (songs.length === 0) return { ok: false, error: '队列为空' };
    const items = songs.map((s: any, i: number) => normalizeQueueItem(s, i));
    const st = await d.player.setQueue(items, Number(b.index) || 0);
    return { ok: true, ...st };
  });

  /** 追加到队列尾部 */
  app.post('/api/player/append', async (req) => {
    const b = (req.body || {}) as any;
    const songs = Array.isArray(b.songs) ? b.songs : [b.song].filter(Boolean);
    if (songs.length === 0) return { ok: false, error: '没有可追加的歌曲' };
    return { ok: true, ...d.player.append(songs.map((s: any, i: number) => normalizeQueueItem(s, i))) };
  });

  /** 跳到指定下标 */
  app.post('/api/player/jump', async (req) => {
    const b = (req.body || {}) as any;
    return { ok: true, ...(await d.player.jump(Number(b.index))) };
  });

  app.post('/api/player/next', async (req) => {
    const b = (req.body || {}) as any;
    // manual=true 表示用户主动按的；自动播完由前端传 manual:false
    return { ok: true, ...(await d.player.next(b.manual !== false)) };
  });

  app.post('/api/player/prev', async () => ({ ok: true, ...(await d.player.prev()) }));

  app.post('/api/player/repeat', async (req) => {
    const b = (req.body || {}) as any;
    const mode = String(b.mode || '') as RepeatMode;
    if (!['list', 'single', 'shuffle'].includes(mode)) {
      return { ok: false, error: 'mode 必须是 list / single / shuffle' };
    }
    return { ok: true, ...d.player.setRepeat(mode) };
  });

  app.post('/api/player/playing', async (req) => {
    const b = (req.body || {}) as any;
    return { ok: true, ...d.player.setPlaying(b.playing !== false) };
  });

  app.post('/api/player/volume', async (req) => {
    const b = (req.body || {}) as any;
    return { ok: true, ...d.player.setVolume(Number(b.volume) || 0) };
  });

  /**
   * 上报播放位置（毫秒）。
   *
   * 这是「划掉页面再回来接着听」的另一半：队列恢复了但位置不恢复，
   * 续播还是从头开始 —— 看起来就像进度压根没保存。
   */
  app.post('/api/player/position', async (req) => {
    const b = (req.body || {}) as any;
    return { ok: true, ...d.player.setPosition(Number(b.positionMs) || 0) };
  });

  /** 从队列移除一项（按 uid） */
  app.post('/api/player/remove', async (req) => {
    const b = (req.body || {}) as any;
    return { ok: true, ...d.player.remove(String(b.uid || '')) };
  });

  app.post('/api/player/clear', async () => ({ ok: true, ...d.player.clear() }));

  /** 队列持久化：把当前队列原样存下来，下次可恢复 */
  app.get('/api/player/queue', async () => ({ queue: d.player.snapshot().queue }));

  /**
   * 歌词。两种取法：
   *   1) 带 filePath（本地歌）→ 读同名 .lrc
   *   2) 带 title/artist（在线歌）→ 走在线歌词接口
   */
  app.get('/api/lyrics', async (req) => {
    const q = req.query as any;
    const title = String(q.title || '').trim();
    const relPath = q.filePath ? String(q.filePath) : undefined;
    if (!title && !relPath) return { ok: false, error: '需要 title 或 filePath' };
    const r = await d.lyrics.get(relPath, title || relPath || '', q.artist ? String(q.artist) : undefined,
      q.platform ? String(q.platform) : undefined, q.songId ? String(q.songId) : undefined);
    return { ok: true, ...r };
  });

  // 平台可用性说明（哪些平台搜索可用 / 哪些已下线）
  app.get('/api/platforms', async () => ({
    active: d.engine.searchPlatforms,
    retired: d.engine.retiredPlatforms,
  }));

  // ---------- 点歌（核心） ----------
  app.post('/api/play', async (req) => {
    const b = req.body as any;
    const keyword = String(b?.keyword || '').trim();
    if (!keyword) return { ok: false, error: '缺少 keyword' };
    const r = await d.orchestrator.resolveAndPlay(keyword, b.artist, b.quality);
    if (!r) return { ok: false, error: '未找到可播放音源' };
    return { ok: true, ...r };
  });

  /**
   * 按**精确曲目 ID** 入库（不经过搜索打分）。
   *
   * 为什么需要它：/api/play 只吃 keyword + artist，会把推荐位带来的精确
   * 平台 ID 丢掉，退化成「按歌名重新搜一遍」—— 于是很可能入库到翻唱版。
   * 推荐 / 榜单里每首都自带 platform + id，直接按 ID 取链才能保住原唱。
   */
  app.post('/api/fetch-by-id', async (req) => {
    const b = (req.body || {}) as any;
    const platform = String(b?.platform || '').trim();
    const id = String(b?.songId ?? b?.id ?? '').trim();
    if (!platform || !id) return { ok: false, error: '缺少 platform / songId' };

    const song = {
      platform,
      id,
      title: String(b?.title || '').trim(),
      artist: String(b?.artist || '').trim(),
      album: b?.album ? String(b.album) : undefined,
      coverUrl: b?.coverUrl ? String(b.coverUrl) : undefined,
      duration: Number(b?.duration) || undefined,
      // 取链时回传给脚本的原始信息；这里没有搜索原文，用自身兜底
      raw: b?.raw ?? undefined,
    };

    const r = await d.orchestrator.fetchById(song as any, b?.quality);
    return r.ok ? { ok: true, taskId: r.taskId } : { ok: false, error: r.error || '入库失败' };
  });

  // ---------- 网易云（eapi，带登录态）----------
  //
  // ⚠️ cookie 含 MUSIC_U 等凭据：**绝不可**出现在任何响应或日志里。
  // 下面所有接口只回「是否登录 / 昵称 / 歌单元数据」，不吐 cookie 原文。

  /** 登录状态（不泄露任何凭据） */
  app.get('/api/netease/status', async () => {
    try {
      const logged = d.netease.isLoggedIn();
      const acc = logged ? await d.netease.account() : null;
      return {
        ok: true,
        loggedIn: logged,
        nickname: acc?.nickname || undefined,
        userId: acc?.userId || undefined,
      };
    } catch (e) {
      return { ok: false, loggedIn: false, error: String(e).slice(0, 160) };
    }
  });

  /**
   * 取二维码（返回 unikey、二维码内容 URL 与可直接渲染的 dataUrl）。
   *
   * 为什么服务端直接出图：前端没有二维码库，若只给 url 让前端自己生成，
   * 就得再引一个前端依赖；服务端用 qrcode 生成 dataUrl，前端直接 <img> 即可。
   */
  app.post('/api/netease/qr', async () => {
    const unikey = await d.netease.qrKey();
    if (!unikey) return { ok: false, error: '取二维码失败（eapi 不可达或返回空）' };
    const url = d.netease.qrUrl(unikey);
    let dataUrl = '';
    try {
      const { toDataURL } = await import('qrcode');
      dataUrl = await toDataURL(url, { width: 320, margin: 1 });
    } catch (e) {
      // 出图失败不该让登录流程整体不可用：前端可退化成展示 url 链接
      logger.warn({ err: String(e).slice(0, 120) }, '二维码生成失败');
    }
    return { ok: true, unikey, url, dataUrl };
  });

  /** 轮询扫码状态：800 过期 / 801 待扫码 / 802 待确认 / 803 成功 */
  app.get('/api/netease/qr/check', async (req) => {
    const key = String((req.query as any)?.key || '').trim();
    if (!key) return { ok: false, error: '缺少 key' };
    const r = await d.netease.qrCheck(key);
    return { ok: true, code: r.code, message: r.message, loggedIn: d.netease.isLoggedIn() };
  });

  /** 退出登录 */
  app.post('/api/netease/logout', async () => {
    await d.netease.logout();
    return { ok: true, loggedIn: false };
  });

  /** 个人歌单（需登录） */
  app.get('/api/netease/playlists', async () => {
    if (!d.netease.isLoggedIn()) return { ok: false, error: '未登录网易云', playlists: [] };
    try {
      const playlists = await d.netease.playlists(50);
      return { ok: true, playlists };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 160), playlists: [] };
    }
  });

  /** 歌单曲目（需登录） */
  app.get('/api/netease/playlist/:id/tracks', async (req) => {
    if (!d.netease.isLoggedIn()) return { ok: false, error: '未登录网易云', tracks: [] };
    const id = Number((req.params as any)?.id || 0);
    if (!id) return { ok: false, error: '缺少歌单 id', tracks: [] };
    try {
      const ids = await d.netease.playlistTrackIds(id);
      const songs = await d.netease.songDetails(ids.slice(0, 100));
      const tracks = songs.map((s: any) => ({
        id: String(s?.id ?? ''),
        title: String(s?.name ?? ''),
        artist: (s?.artists || []).map((a: any) => String(a?.name ?? '')).filter(Boolean).join('/'),
        album: s?.album?.name ? String(s.album.name) : undefined,
        coverUrl: s?.album?.picUrl ? String(s.album.picUrl) : undefined,
        duration: Number(s?.duration ?? 0) / 1000 || undefined,
        platform: 'wy',
      })).filter((t: any) => t.id && t.title);
      return { ok: true, tracks };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 160), tracks: [] };
    }
  });

  /** 每日推荐（登录后为个性化；未登录是全网通用） */
  app.get('/api/netease/recommend', async () => {
    try {
      const songs = await d.netease.recommendSongs();
      const items = songs.map((s: any) => ({
        id: String(s?.id ?? ''),
        title: String(s?.name ?? ''),
        artist: (s?.artists || s?.ar || []).map((a: any) => String(a?.name ?? '')).filter(Boolean).join('/'),
        album: s?.album?.name ? String(s.album.name) : undefined,
        coverUrl: s?.album?.picUrl ? String(s.album.picUrl) : undefined,
        duration: Number(s?.duration ?? s?.dt ?? 0) / 1000 || undefined,
        platform: 'wy',
      })).filter((t: any) => t.id && t.title);
      return { ok: true, personalized: d.netease.isLoggedIn(), items };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 160), items: [] };
    }
  });

  // ---------- 下载队列 ----------
  app.get('/api/downloads', async () => ({ queue: d.downloader.status(), logs: d.lib.recentLogs(30) }));

  // ---------- 刮削 ----------
  app.post('/api/scraper/audit', async (req) => d.scraper.audit(Number((req.body as any)?.limit) || 200));

  // 批量补全缺失的标签 / 封面 / 歌词（主动刮削）
  app.post('/api/scraper/backfill', async (req) => {
    const limit = Math.min(Math.max(1, Number((req.body as any)?.limit) || 20), 100);
    return d.scraper.backfill(limit);
  });

  /** 单首刮削：重写标签 / 封面 / 歌词，并刷新封面缓存（曲库详情页「重新刮削这首」） */
  app.post('/api/scraper/song', async (req) => {
    const b = (req.body || {}) as any;
    const rel = String(b.filePath || '').trim();
    if (!rel) return { ok: false, error: '缺少 filePath' };
    const song = d.lib.findByPath(rel);
    if (!song) return { ok: false, error: '曲库未收录该文件' };
    const abs = path.resolve(loadConfig().musicDir, rel);
    const r = await d.scraper.applyToFile(abs, {
      title: song.title, artist: song.artist, album: song.album,
      id: String(song.id), platform: 'local',
    });
    await d.lib.extractCoverFor(rel);
    return { ok: true, ...r };
  });

  // ---------- 歌单（命名的可持久化队列） ----------
  // 主页展示用；播放即把整张歌单的本地曲目灌入服务端队列并按序播放。
  /**
   * 首页一次拿齐：推荐分区 + 歌单 + 统计。
   *
   * 为什么做成聚合接口：首页原本要分别打 library / playlists / stats 三个请求，
   * 首屏三跳延迟串行叠加，且各自 loading 容易让板块错位跳动。
   */
  app.get('/api/home', async () => {
    const all = d.lib.listAll(2000, 0);
    const byAlbum = new Map<string, any[]>();
    const byArtist = new Map<string, any[]>();
    for (const s of all) {
      const ak = String(s.album || '未知专辑');
      if (!byAlbum.has(ak)) byAlbum.set(ak, []);
      byAlbum.get(ak)!.push(s);
      const rk = String(s.artist || '未知歌手');
      if (!byArtist.has(rk)) byArtist.set(rk, []);
      byArtist.get(rk)!.push(s);
    }
    const pick = (m: Map<string, any[]>, n: number) =>
      [...m.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, n)
        .map(([name, songs]) => ({ name, count: songs.length, cover: songs.find((x) => x.cover)?.cover || null }));

    return {
      stats: d.lib.stats(),
      playlists: d.lib.listPlaylists(),
      // 「最近入库」按 id 倒序（id 即入库顺序）
      recent: all.slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 12),
      albums: pick(byAlbum, 12),
      artists: pick(byArtist, 12),
    };
  });

  /**
   * 在线推荐（榜单）。
   *
   * 曲库小的时候，本地那几个维度（最近入库/专辑/歌手）很快就没什么可推荐的，
   * 首页看着是空的。这里补一个在线源。
   *
   * ⚠️ 失败返回空数组而不是抛错：在线推荐只是锦上添花，
   * 网络不通不该让首页整体加载失败。
   */
  app.get('/api/recommend', async () => {
    try {
      const { fetchRecommendBoards } = await import('../services/recommend/index.js');
      const boards = await fetchRecommendBoards(12);
      return { ok: true, boards };
    } catch (e) {
      logger.warn({ err: String(e).slice(0, 160) }, '在线推荐获取失败');
      return { ok: false, boards: [] };
    }
  });

  app.get('/api/playlists', async () => ({ playlists: d.lib.listPlaylists() }));

  app.post('/api/playlists', async (req) => {
    const b = (req.body || {}) as any;
    const r = d.lib.createPlaylist(String(b.name || '').trim());
    return { ok: true, ...r };
  });

  app.delete('/api/playlists/:id', async (req) => {
    const id = Number((req.params as any).id);
    return d.lib.deletePlaylist(id);
  });

  app.get('/api/playlists/:id', async (req) => {
    const id = Number((req.params as any).id);
    const p = d.lib.getPlaylist(id);
    if (!p) return { ok: false, error: '歌单不存在' };
    return { ok: true, ...p };
  });

  app.post('/api/playlists/:id/tracks', async (req) => {
    const id = Number((req.params as any).id);
    const b = (req.body || {}) as any;
    if (Array.isArray(b.songIds) && b.songIds.length) {
      for (const sid of b.songIds) d.lib.addToPlaylist(id, Number(sid));
      return { ok: true };
    }
    if (b.songId) return d.lib.addToPlaylist(id, Number(b.songId));
    return { ok: false, error: '缺少 songId' };
  });

  app.delete('/api/playlists/:id/tracks/:songId', async (req) => {
    const id = Number((req.params as any).id);
    const sid = Number((req.params as any).songId);
    return d.lib.removeFromPlaylist(id, sid);
  });

  /** 播放整张歌单：本地曲目直接给 /stream 直链，不耗音源额度 */
  app.post('/api/playlists/:id/play', async (req) => {
    const id = Number((req.params as any).id);
    const p = d.lib.getPlaylist(id);
    if (!p || !p.tracks.length) return { ok: false, error: '歌单为空' };
    const items = p.tracks.map((s, i) => normalizeQueueItem({
      title: s.title, artist: s.artist, album: s.album, filePath: s.filePath,
      platform: 'local', songId: String(s.id), cover: (s as any).cover,
    }, i));
    const st = await d.player.setQueue(items, 0);
    return { ok: true, ...st };
  });

  // ---------- 本地文件流 ----------
  app.get('/stream/*', async (req, reply) => {
    const rel = decodeURIComponent((req.params as any)['*'] || '');
    const hit = d.orchestrator.streamPath(rel);
    if (!hit) return reply.code(404).send({ error: 'not found' });

    const ext = rel.split('.').pop()?.toLowerCase();
    const mime = ext === 'flac' ? 'audio/flac'
      : ext === 'mp3' ? 'audio/mpeg'
      : ext === 'm4a' ? 'audio/mp4'
      : ext === 'wav' ? 'audio/wav'
      : ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m?.[1] || 0);
      const end = m?.[2] ? Number(m[2]) : hit.size - 1;
      reply.code(206)
        .header('Content-Range', `bytes ${start}-${end}/${hit.size}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', end - start + 1)
        .header('Content-Type', mime);
      return reply.send(fs.createReadStream(hit.abs, { start, end }));
    }
    reply.header('Content-Length', hit.size).header('Content-Type', mime).header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(hit.abs));
  });

  // ---------- 曲库封面 ----------
  //
  // 封面由 library 扫描时从音频内嵌图片抽出，落在 data/covers 下，
  // 这里只做「按名取文件」。名字是服务端生成的 sha1，不接受任何路径成分。
  app.get('/cover/:name', async (req, reply) => {
    const name = String((req.params as any).name || '');
    const abs = d.lib.coverPath(name);
    if (!abs) return reply.code(404).send({ error: 'not found' });
    const ext = name.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    // 缓存一天：封面内容按文件路径做键，同一首歌不会变
    return reply
      .header('Content-Type', mime)
      .header('Cache-Control', 'public, max-age=86400')
      .send(fs.createReadStream(abs));
  });

  // ---------- 在线直链代理 ----------
  app.get('/proxy', async (req, reply) => {
    const url = String((req.query as any).url || '');
    if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'invalid url' });
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', ...(req.headers.range ? { Range: req.headers.range } : {}) },
      });
      const h: Record<string, string> = {};
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = res.headers.get(k);
        if (v) h[k] = v;
      }
      reply.code(res.status).headers(h);
      if (!res.body) return reply.send();
      return reply.send(Readable.fromWeb(res.body as any));
    } catch (e) {
      return reply.code(502).send({ error: String(e) });
    }
  });
}
