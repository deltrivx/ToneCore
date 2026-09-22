import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from './index.js';

/**
 * Subsonic REST API 兼容层：`/rest/*`
 *
 * 为什么做这个：Subsonic REST 是自托管音乐领域的**事实标准**，
 * 箭头音乐（amcfy-music）、Feishin、Sonixd、Substreamer、play:Sub、Symfonium
 * 等一大批客户端都支持它。实现它 = 一批 App 直接可用。
 * 且它自带 `scrobble`（播报播放/进度），正好承载「跨设备续播」。
 *
 * 协议要点（依据官方 API 文档）：
 *   - 基址 `/rest/<method>`（历史写法 `.view` 后缀也要接受）
 *   - 通用参数：`u` 用户名、`v` 协议版本、`c` 客户端名、`f` 格式（xml|json）
 *   - 认证二选一：
 *       p=<明文密码> 或 p=enc:<hex>
 *       t=md5(password + salt) & s=<salt≥6位>
 *   - 响应信封：`{ "subsonic-response": { status, version, ... } }`
 *     失败时为 `{ status:"failed", error:{ code, message } }`
 *   - 错误码：40 用户名或密码错误 / 70 未找到 / 10 缺参数
 *
 * 注意：客户端普遍**默认请求 XML**，但绝大多数也支持 `f=json`。
 * 我们只实现 JSON（不发 XML），并在信封里如实声明 version，
 * 让客户端按自身能力选择；对纯 XML 客户端会连不上 —— 这是已知取舍。
 */
export async function registerSubsonicRoutes(app: FastifyInstance, d: Deps): Promise<void> {
  const API_VERSION = '1.16.1';

  /** 统一响应信封 */
  function ok(data: Record<string, any> = {}) {
    return { 'subsonic-response': { status: 'ok', version: API_VERSION, type: 'ToneCore', serverVersion: 'ToneCore', ...data } };
  }
  function fail(reply: FastifyReply, code: number, message: string) {
    return reply.code(200).send({
      'subsonic-response': { status: 'failed', version: API_VERSION, error: { code, message } },
    });
  }

  /**
   * 认证：支持 p=(明文/enc:hex) 与 t+s=(token md5) 两种。
   * 返回用户名；失败回 null（调用方负责回 40）。
   */
  function authenticate(q: any): string | null {
    const u = String(q.u || '').trim();
    if (!u) return null;

    // 方式一：token + salt（t = md5(明文密码 + salt)，由 auth 使用密码副本校验）
    if (q.t && q.s) {
      const user = d.auth.verifyTokenStyle(u, String(q.t), String(q.s));
      return user ? user.username : null;
    }

    // 方式二：明文或 enc:hex
    let pwd = String(q.p || '');
    if (pwd.startsWith('enc:')) {
      try { pwd = Buffer.from(pwd.slice(4), 'hex').toString('utf8'); } catch { return null; }
    }
    const user = d.auth.checkPassword(u, pwd);
    return user ? user.username : null;
  }

  /** 取当前用户名；未通过认证时直接回 40 并返回 null */
  function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
    const u = authenticate(req.query as any);
    if (!u) { fail(reply, 40, 'Wrong username or password'); return null; }
    return u;
  }

  /** 注册一个方法：同时接受 /rest/xxx 与 /rest/xxx.view */
  function method(name: string, handler: (username: string, q: any, req: FastifyRequest, reply: FastifyReply) => any) {
    const path = `/rest/${name}`;
    app.get(path, async (req, reply) => {
      const u = requireAuth(req, reply);
      if (!u) return;
      return handler(u, req.query as any, req, reply);
    });
    app.get(`${path}.view`, async (req, reply) => {
      const u = requireAuth(req, reply);
      if (!u) return;
      return handler(u, req.query as any, req, reply);
    });
  }

  // ==================== 连通性 ====================
  method('ping', () => ok());

  /** 服务端能力声明：客户端据此决定用什么接口 */
  method('getLicense', () => ok({ license: { valid: true } }));

  method('getMusicFolders', () => ok({ musicFolders: { musicFolder: [{ id: '1', name: '音乐库' }] } }));

  // ==================== 浏览：歌手 / 专辑 ====================
  /** 把曲库聚合成「歌手 → 专辑 → 歌曲」三级结构（Subsonic 的 ID3 组织方式） */
  function buildIndex() {
    const songs = d.lib.listAll(100000, 0);
    const artistMap = new Map<string, { id: string; name: string; albums: Map<string, any> }>();
    for (const s of songs) {
      const artist = s.artist || '未知歌手';
      const album = s.album || '未知专辑';
      const aid = 'ar-' + Buffer.from(artist).toString('hex').slice(0, 24);
      if (!artistMap.has(artist)) artistMap.set(artist, { id: aid, name: artist, albums: new Map() });
      const a = artistMap.get(artist)!;
      const alid = 'al-' + Buffer.from(artist + '|' + album).toString('hex').slice(0, 24);
      if (!a.albums.has(album)) {
        a.albums.set(album, { id: alid, name: album, artist, artistId: aid, songs: [], cover: s.cover });
      }
      a.albums.get(album).songs.push(s);
    }
    return artistMap;
  }

  function songJson(s: any) {
    return {
      id: String(s.id),
      parent: String(s.id),
      isDir: false,
      title: s.title,
      album: s.album || '',
      artist: s.artist || '',
      track: 0,
      year: 0,
      genre: '',
      coverArt: s.cover ? 'so-' + s.id : undefined,
      size: 0,
      contentType: 'audio/mpeg',
      suffix: 'mp3',
      duration: s.duration ? Math.round(s.duration) : 0,
      bitRate: 0,
      path: s.filePath || '',
      playCount: 0,
      created: new Date(s.addedAt || Date.now()).toISOString(),
      type: 'music',
    };
  }

  function albumJson(a: any, withSongs: boolean) {
    return {
      id: a.id, name: a.name, artist: a.artist, artistId: a.artistId,
      coverArt: a.cover ? 'so-album-' + a.id : undefined,
      songCount: a.songs.length,
      duration: a.songs.reduce((n: number, s: any) => n + (s.duration || 0), 0),
      created: new Date().toISOString(),
      playCount: 0,
      ...(withSongs ? { song: a.songs.map(songJson) } : {}),
    };
  }

  method('getArtists', () => {
    const idx = buildIndex();
    const artists = [...idx.values()].map((a) => ({
      id: a.id, name: a.name, albumCount: a.albums.size,
    }));
    // Subsonic 按首字母分组
    const groups = new Map<string, any[]>();
    for (const a of artists) {
      const ch = /^[a-zA-Z]/.test(a.name) ? a.name[0].toUpperCase() : '#';
      if (!groups.has(ch)) groups.set(ch, []);
      groups.get(ch)!.push(a);
    }
    return ok({
      artists: {
        ignoredArticles: 'The El La Los Las Le Les',
        index: [...groups.entries()].sort(([x], [y]) => x.localeCompare(y))
          .map(([name, artist]) => ({ name, artist })),
      },
    });
  });

  /** 兼容老客户端：按目录结构浏览（这里用同一份索引模拟） */
  method('getIndexes', () => {
    const idx = buildIndex();
    const artists = [...idx.values()].map((a) => ({ id: a.id, name: a.name, albumCount: a.albums.size }));
    const groups = new Map<string, any[]>();
    for (const a of artists) {
      const ch = /^[a-zA-Z]/.test(a.name) ? a.name[0].toUpperCase() : '#';
      if (!groups.has(ch)) groups.set(ch, []);
      groups.get(ch)!.push(a);
    }
    return ok({
      indexes: {
        lastModified: Date.now(),
        ignoredArticles: 'The El La Los Las Le Les',
        index: [...groups.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([name, artist]) => ({ name, artist })),
      },
    });
  });

  method('getAlbumList2', (u, q) => {
    const idx = buildIndex();
    const all: any[] = [];
    for (const a of idx.values()) for (const al of a.albums.values()) all.push(albumJson(al, false));
    let list = all;
    const type = String(q.type || 'alphabeticalByName');
    if (type === 'newest') list = [...all].sort((x, y) => String(y.created).localeCompare(String(x.created)));
    else if (type === 'random') list = [...all].sort(() => Math.random() - 0.5);
    else if (type === 'alphabeticalByArtist') list = [...all].sort((x, y) => x.artist.localeCompare(y.artist));
    else list = [...all].sort((x, y) => x.name.localeCompare(y.name));

    const offset = Math.max(0, Number(q.offset) || 0);
    const size = Math.max(1, Math.min(500, Number(q.size) || 10));
    return ok({ albumList2: { album: list.slice(offset, offset + size) } });
  });

  /** 兼容老客户端（getAlbumList 用 albumList 包裹） */
  method('getAlbumList', (u, q) => {
    const r: any = (method as any) && null;
    const idx = buildIndex();
    const all: any[] = [];
    for (const a of idx.values()) for (const al of a.albums.values()) all.push(albumJson(al, false));
    const offset = Math.max(0, Number(q.offset) || 0);
    const size = Math.max(1, Math.min(500, Number(q.size) || 10));
    const list = all.sort((x, y) => x.name.localeCompare(y.name)).slice(offset, offset + size);
    return ok({ albumList: { album: list } });
  });

  method('getAlbum', (u, q, req, reply) => {
    const id = String(q.id || '');
    const idx = buildIndex();
    for (const a of idx.values()) {
      for (const al of a.albums.values()) {
        if (al.id === id) return ok({ album: albumJson(al, true) });
      }
    }
    // 兼容「直接传歌曲 id」的客户端
    const s = d.lib.findById(Number(id));
    if (s) {
      const al = {
        id: 'al-' + String(s.id), name: s.album || '未知专辑', artist: s.artist || '',
        artistId: 'ar-0', cover: s.cover, songs: [s],
      };
      return ok({ album: albumJson(al, true) });
    }
    return fail(reply, 70, 'Album not found');
  });

  method('getArtist', (u, q, req, reply) => {
    const id = String(q.id || '');
    const idx = buildIndex();
    for (const a of idx.values()) {
      if (a.id === id) {
        return ok({
          artist: {
            id: a.id, name: a.name, albumCount: a.albums.size,
            album: [...a.albums.values()].map((al) => albumJson(al, false)),
          },
        });
      }
    }
    return fail(reply, 70, 'Artist not found');
  });

  // ==================== 搜索 ====================
  method('search3', (u, q) => {
    const kw = String(q.query || '').trim();
    if (!kw) return ok({ searchResult3: { artist: [], album: [], song: [] } });
    const songs = d.lib.search(kw, 100, 0);
    const idx = buildIndex();
    const artists: any[] = [];
    const albums: any[] = [];
    for (const a of idx.values()) {
      if (a.name.toLowerCase().includes(kw.toLowerCase())) {
        artists.push({ id: a.id, name: a.name, albumCount: a.albums.size });
      }
      for (const al of a.albums.values()) {
        if (al.name.toLowerCase().includes(kw.toLowerCase())) albums.push(albumJson(al, false));
      }
    }
    return ok({
      searchResult3: {
        artist: artists.slice(0, Number(q.artistCount) || 20),
        album: albums.slice(0, Number(q.albumCount) || 20),
        song: songs.slice(0, Number(q.songCount) || 20).map(songJson),
      },
    });
  });

  method('search2', (u, q) => {
    const kw = String(q.query || '').trim();
    const songs = kw ? d.lib.search(kw, 100, 0) : [];
    const idx = buildIndex();
    const albums: any[] = [];
    for (const a of idx.values()) for (const al of a.albums.values()) {
      if (kw && al.name.toLowerCase().includes(kw.toLowerCase())) albums.push(albumJson(al, false));
    }
    return ok({ searchResult2: { artist: [], album: albums, song: songs.map(songJson) } });
  });

  // ==================== 播放 ====================
  /**
   * 取流。客户端会带 maxBitRate / format 等参数，这里一律原样回源文件，
   * 不转码（自建场景下直出无损更合理）。
   */
  method('stream', (u, q, req, reply) => {
    const id = Number(q.id);
    if (!id) return fail(reply, 10, 'Required parameter is missing: id');
    const song = d.lib.findById(id);
    if (!song) return fail(reply, 70, 'Song not found');
    // 真实流端点是 /stream/<相对路径>（支持 Range —— 客户端拖进度依赖它）。
    // 注意不是 /api/library/<id>/stream（那个路径不存在，会 404）。
    return reply.redirect('/stream/' + encodeURIComponent(song.filePath));
  });

  /** 下载（部分客户端「离线缓存」走这个） */
  method('download', (u, q, req, reply) => {
    const id = Number(q.id);
    if (!id) return fail(reply, 10, 'Required parameter is missing: id');
    const song = d.lib.findById(id);
    if (!song) return fail(reply, 70, 'Song not found');
    return reply.redirect('/stream/' + encodeURIComponent(song.filePath));
  });

  // ==================== 封面 / 歌词 ====================
  method('getCoverArt', (u, q, req, reply) => {
    let id = String(q.id || '');
    // 我们给歌曲发的 coverArt 是 'so-<songId>'，专辑是 'so-album-<albumKey>'
    id = id.replace(/^so-album-/, '').replace(/^so-/, '');
    const n = Number(id);
    if (Number.isFinite(n)) {
      const s = d.lib.findById(n);
      if (s?.cover) return reply.redirect(`/cover/${s.cover}`);
    }
    return fail(reply, 70, 'Cover art not found');
  });

  method('getLyrics', async (u, q, req, reply) => {
    const artist = String(q.artist || '');
    const title = String(q.title || '');
    try {
      const r = await d.lyrics.get(undefined, title, artist);
      const lines = (r?.lines || []).map((l: any) => l.text).join('\n');
      return ok({ lyrics: { artist, title, value: lines } });
    } catch {
      return ok({ lyrics: { artist, title, value: '' } });
    }
  });

  method('getLyricsBySongId', async (u, q, req, reply) => {
    const id = Number(q.id);
    const s = id ? d.lib.findById(id) : null;
    if (!s) return fail(reply, 70, 'Song not found');
    try {
      const r = await d.lyrics.get(s.filePath, s.title, s.artist);
      const lines = (r?.lines || []).map((l: any) => ({
        start: Math.round((l.time || 0) * 1000), value: l.text || '',
      }));
      return ok({ lyricsList: { structuredLyrics: [{ displayArtist: s.artist, displayTitle: s.title, line: lines }] } });
    } catch {
      return ok({ lyricsList: { structuredLyrics: [] } });
    }
  });

  method('getSong', (u, q, req, reply) => {
    const s = d.lib.findById(Number(q.id));
    if (!s) return fail(reply, 70, 'Song not found');
    return ok({ song: songJson(s) });
  });

  // ==================== 播放上报（进度记忆的核心） ====================
  /**
   * scrobble：客户端在开始播放（submission=false）与听完/切歌（submission=true）时调用。
   * 我们据此写入「播放历史」与「播放进度」—— 这就是跨设备续播的数据来源。
   */
  method('scrobble', (u, q) => {
    const ids = [].concat(q.id || []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
    const submission = String(q.submission ?? 'true') !== 'false';
    const positionMs = Number(q.time) > 0 ? Number(q.time) : 0;
    for (const id of ids) {
      const s = d.lib.findById(id);
      if (!s) continue;
      d.auth.recordPlay({ songId: id, title: s.title, artist: s.artist, album: s.album, source: 'subsonic' });
      if (positionMs > 0) {
        d.auth.saveProgress(u, {
          songKey: id, songId: id, title: s.title, artist: s.artist, album: s.album,
          positionMs, durationMs: Math.round((s.duration || 0) * 1000),
        });
      } else if (!submission) {
        // now-playing 通知：从头开始，记 0
        d.auth.saveProgress(u, {
          songKey: id, songId: id, title: s.title, artist: s.artist, album: s.album,
          positionMs: 0, durationMs: Math.round((s.duration || 0) * 1000),
        });
      }
    }
    return ok();
  });

  /** 正在播放（客户端据此显示其它设备在播什么） */
  method('getNowPlaying', (u) => ok({ nowPlaying: { entry: [] } }));

  /** 播放统计：播放次数与最后播放时间 */
  method('getPlayCounts', (u) => ok({ playCounts: {} }));

  // ==================== 歌单 ====================
  method('getPlaylists', (u) => {
    const pls = d.lib.listPlaylists();
    return ok({
      playlists: {
        playlist: pls.map((p) => ({
          id: String(p.id), name: p.name, songCount: p.count,
          duration: 0, created: new Date(p.createdAt).toISOString(), changed: new Date(p.createdAt).toISOString(),
        })),
      },
    });
  });

  method('getPlaylist', (u, q, req, reply) => {
    const pl = d.lib.getPlaylist(Number(q.id));
    if (!pl) return fail(reply, 70, 'Playlist not found');
    return ok({
      playlist: {
        id: String(pl.id), name: pl.name, songCount: pl.tracks.length,
        duration: 0, created: new Date().toISOString(), changed: new Date().toISOString(),
        entry: pl.tracks.map(songJson),
      },
    });
  });

  method('createPlaylist', (u, q) => {
    const name = String(q.name || '新歌单');
    const r = d.lib.createPlaylist(name);
    // songId 可能是单值或数组
    const ids = [].concat(q.songId || []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
    for (const id of ids) d.lib.addToPlaylist(r.id, id);
    return ok();
  });

  method('updatePlaylist', (u, q) => {
    const pid = Number(q.playlistId);
    if (!pid) return ok();
    const add = [].concat(q.songIdToAdd || []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
    for (const id of add) d.lib.addToPlaylist(pid, id);
    const del = [].concat(q.songIndexToRemove || []).map((x: any) => Number(x));
    const pl = d.lib.getPlaylist(pid);
    if (pl) {
      // 按索引移除（先算好再删，避免边删边错位）
      const targets = del.map((i: number) => pl.tracks[i]).filter(Boolean);
      for (const t of targets) d.lib.removeFromPlaylist(pid, (t as any).id);
    }
    return ok();
  });

  method('deletePlaylist', (u, q) => {
    const pid = Number(q.id);
    if (pid) d.lib.deletePlaylist(pid);
    return ok();
  });

  // ==================== 收藏 / 评分（客户端会调用，给了空实现避免报错） ====================
  method('getStarred', () => ok({ starred: { artist: [], album: [], song: [] } }));
  method('getStarred2', () => ok({ starred2: { artist: [], album: [], song: [] } }));
  method('star', () => ok());
  method('unstar', () => ok());
  method('setRating', () => ok());
  method('getRandomSongs', (u, q) => {
    const songs = d.lib.list(Math.max(1, Number(q.size) || 20), 0);
    return ok({ randomSongs: { song: songs.map(songJson) } });
  });
  method('getSongsByGenre', () => ok({ songsByGenre: { song: [] } }));
  method('getGenres', () => ok({ genres: { genre: [] } }));
  method('getScanStatus', () => ok({ scanStatus: { scanning: false, count: d.lib.count() } }));
  method('startScan', () => ok({ scanStatus: { scanning: true, count: d.lib.count() } }));
}
