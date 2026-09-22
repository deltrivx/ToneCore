import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../services/auth/index.js';
import type { Deps } from './index.js';
import { VERSION } from '../version.js';

/**
 * SongLoft 兼容层：`/api/v1/*`
 *
 * 目的：让「按 SongLoft 方式连接」的外部设备 / 客户端可以连到 ToneCore。
 *
 * 协议依据（实测 SongLoft v2.12.1，非猜测）：
 *   - 登录 `POST /api/v1/auth/login` {username,password}
 *     → { access_token, refresh_token, expires_in, token_type:"Bearer" }
 *   - 鉴权 `Authorization: Bearer <access_token>`
 *   - 健康 `GET /api/v1/health` → {"status":"ok"}
 *   - 版本 `GET /api/v1/version` → { version, git_commit, build_time, full, build_type }
 *   - 错误体 `{ "detail": "<code>", "error": "<中文描述>" }`
 *
 * 端点清单来自对 SongLoft 前端产物与运行日志的提取，见
 * `.workbuddy/reference/songloft-api-paths.txt`。
 */

/** 未鉴权时的统一错误体（与 SongLoft 同构） */
function unauthorized(reply: FastifyReply, detail = 'unauthorized', error = '未登录或令牌无效') {
  return reply.code(401).send({ detail, error });
}

/** 从请求取出当前用户；失败直接回 401 */
function requireUser(d: Deps, req: FastifyRequest, reply: FastifyReply) {
  const u = d.auth.userFromHeader(req.headers.authorization);
  if (!u) { unauthorized(reply); return null; }
  return u;
}

/**
 * 把曲库相对路径转成安全的 URL 路径。
 *
 * 关键：**不能整串 encodeURIComponent** —— 它会把 '/' 编成 %2F，
 * 而 Fastify 的通配路由 /stream/* 不匹配含 %2F 的路径，直接 404/502。
 * 必须逐段编码、保留 '/' 作为分隔符。
 */
function encodeRelPath(p: string): string {
  return String(p || '').split('/').map(encodeURIComponent).join('/');
}

export async function registerSongLoftRoutes(app: FastifyInstance, d: Deps): Promise<void> {
  // ==================== 认证 ====================
  app.post('/api/v1/auth/login', async (req, reply) => {
    const b = (req.body || {}) as any;
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username || !password) {
      return reply.code(400).send({ detail: 'invalid_request', error: '用户名与密码不能为空' });
    }
    const r = d.auth.login(username, password);
    if (!r.ok) return reply.code(401).send({ detail: 'invalid_credentials', error: r.error });
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_in: r.expires_in,
      token_type: r.token_type,
    };
  });

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const b = (req.body || {}) as any;
    // 兼容两种传法：body.refresh_token 或 Authorization: Bearer <refresh>
    const token = String(b.refresh_token || '').trim()
      || (/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] ?? '');
    if (!token) return reply.code(400).send({ detail: 'invalid_request', error: '缺少 refresh_token' });
    const r = d.auth.refresh(token);
    if (!r.ok) return reply.code(401).send({ detail: 'invalid_token', error: r.error });
    return { access_token: r.access_token, expires_in: r.expires_in, token_type: r.token_type };
  });

  app.post('/api/v1/auth/logout', async (req) => {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (m) d.auth.revoke(m[1]);
    return { ok: true };
  });

  /** 当前登录用户（SongLoft 前端用 /api/v1/config 里带用户信息，这里单独给一个更直观的） */
  app.get('/api/v1/me', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return { id: u.id, username: u.username, is_admin: true };
  });

  // ==================== 基础信息 ====================
  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/version', async () => ({
    version: `v${VERSION}`,
    git_commit: '',
    build_time: '',
    build_type: 'full',
    full: `v${VERSION} (ToneCore)`,
  }));

  // ==================== 曲库 ====================
  app.get('/api/v1/songs', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const q = req.query as any;
    const limit = Math.max(1, Math.min(500, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const keyword = String(q.keyword || q.q || '').trim();
    const songs = keyword ? d.lib.search(keyword, limit, offset) : d.lib.list(limit, offset);
    const total = keyword ? d.lib.countSearch(keyword) : d.lib.count();
    return {
      songs: songs.map((s) => ({
        id: s.id, title: s.title, artist: s.artist, album: s.album,
        duration: s.duration ?? 0, path: s.filePath,
        cover_url: s.cover ? `/api/v1/songs/${s.id}/cover` : null,
      })),
      total,
    };
  });

  app.get('/api/v1/songs/search', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const q = req.query as any;
    const kw = String(q.keyword || q.q || '').trim();
    const songs = kw ? d.lib.search(kw, 100, 0) : d.lib.list(100, 0);
    return { songs: songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, album: s.album })), total: songs.length };
  });

  app.get('/api/v1/songs/stats', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return d.lib.stats();
  });

  app.get('/api/v1/stats', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return d.lib.stats();
  });

  // ==================== 歌单 ====================
  app.get('/api/v1/playlists', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return { playlists: d.lib.listPlaylists() };
  });

  app.post('/api/v1/playlists', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    return d.lib.createPlaylist(String(b.name || '新歌单'));
  });

  // ==================== 播放历史 ====================
  app.get('/api/v1/play-history', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const q = req.query as any;
    return { entries: d.auth.history(Number(q.limit) || 50) };
  });

  // ==================== 播放控制（ToneCore 媒体中枢能力） ====================
  app.get('/api/v1/player', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return d.player.snapshot();
  });

  app.post('/api/v1/player/play', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    return d.player.setQueue(b.songs || [], Number(b.index) || 0);
  });

  app.post('/api/v1/player/control', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    const action = String(b.action || '');
    switch (action) {
      case 'play':   return d.player.setPlaying(true);
      case 'pause':  return d.player.setPlaying(false);
      case 'next':   return d.player.next(true);
      case 'prev':   return d.player.prev();
      case 'stop':   return d.player.clear();
      case 'volume': return d.player.setVolume(Number(b.volume) || 0);
      default:
        return reply.code(400).send({ detail: 'invalid_action', error: '不支持的操作：' + action });
    }
  });

  /** 上报播放（写入 play_history，供「最近播放」） */
  app.post('/api/v1/songs/:id/played', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const id = Number((req.params as any).id);
    const song = d.lib.findById(id);
    d.auth.recordPlay({ songId: id, title: song?.title, artist: song?.artist, album: song?.album, source: 'local' });
    return { ok: true };
  });

  // ==================== 流媒体 / 封面（供外部播放器直接取） ====================
  app.get('/api/v1/songs/:id/cover', async (req, reply) => {
    const id = Number((req.params as any).id);
    const song = d.lib.findById(id);
    if (!song?.cover) return reply.code(404).send({ detail: 'not_found', error: '无封面' });
    return reply.redirect(`/cover/${song.cover}`);
  });

  app.get('/api/v1/stream', async (req, reply) => {
    const q = req.query as any;
    const id = Number(q.song_id || q.id || 0);
    if (!id) return reply.code(400).send({ detail: 'invalid_request', error: '缺少 song_id' });
    const song = d.lib.findById(id);
    if (!song) return reply.code(404).send({ detail: 'not_found', error: '曲目不存在' });
    // 与 Subsonic 层一致：真实流端点是 /stream/<相对路径>（需逐段编码）
    return reply.redirect('/stream/' + encodeRelPath(song.filePath));
  });
  // ==================== 账号管理（设置页用） ====================
  app.get('/api/v1/account', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return { id: u.id, username: u.username, nickname: u.nickname, createdAt: u.createdAt };
  });

  /** 一次改完账号名 / 密码 / 昵称；改完吊销旧令牌，前端需重新登录 */
  app.post('/api/v1/account', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    const oldPwd = String(b.currentPassword || '');
    // 改密码必须验证当前密码，避免令牌被盗后直接改掉
    if (b.password && !d.auth.checkPassword(u.username, oldPwd)) {
      return reply.code(403).send({ detail: 'invalid_password', error: '当前密码不正确' });
    }
    const r = d.auth.updateProfile(u.username, {
      username: b.username ? String(b.username).trim() : undefined,
      nickname: typeof b.nickname === 'string' ? b.nickname : undefined,
      password: b.password ? String(b.password) : undefined,
    });
    if (!r.ok) return reply.code(400).send({ detail: 'update_failed', error: r.error });
    return { ok: true, username: r.username };
  });

  // ==================== 播放进度 / 最近播放（跨设备续播） ====================
  app.get('/api/v1/progress', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const q = req.query as any;
    const songKey = q.songKey ?? q.songId;
    if (songKey !== undefined) {
      return { progress: d.auth.getProgress(u.username, songKey as string) };
    }
    return { entries: d.auth.recentProgress(u.username, Number(q.limit) || 20) };
  });

  app.post('/api/v1/progress', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    const songKey = b.songKey ?? b.songId;
    if (songKey === undefined) return reply.code(400).send({ detail: 'invalid_request', error: '缺少 songKey' });
    d.auth.saveProgress(u.username, {
      songKey: String(songKey), songId: b.songId ?? null,
      title: b.title, artist: b.artist, album: b.album,
      positionMs: Number(b.positionMs) || 0, durationMs: Number(b.durationMs) || 0,
    });
    return { ok: true };
  });

  app.delete('/api/v1/progress', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const q = req.query as any;
    if (q.songKey !== undefined) d.auth.clearProgress(u.username, String(q.songKey));
    return { ok: true };
  });

  // ==================== 用户设置（KV 持久化） ====================
  app.get('/api/v1/settings', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    return { settings: d.auth.allSettings(u.username) };
  });

  app.post('/api/v1/settings', async (req, reply) => {
    const u = requireUser(d, req, reply);
    if (!u) return;
    const b = (req.body || {}) as any;
    for (const [k, v] of Object.entries(b || {})) d.auth.setSetting(u.username, k, String(v));
    return { ok: true };
  });
}
