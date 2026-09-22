import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { parseFile } from 'music-metadata';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

export interface LibrarySong {
  id: number;
  title: string;
  artist: string;
  album: string;
  filePath: string;
  duration: number | null;
  addedAt: number;
  /** 封面缓存文件名（data/covers 下）；空串表示无封面 */
  cover?: string;
}

/**
 * 本地曲库：扫描 /music，建立 SQLite 索引，提供检索。
 */
export class Library {
  private db: Database.Database;

  constructor() {
    const cfg = loadConfig();
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    this.db = new Database(path.join(cfg.dataDir, 'tonecore.db'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        title     TEXT NOT NULL,
        artist    TEXT NOT NULL DEFAULT '',
        album     TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL UNIQUE,
        duration  REAL,
        added_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_songs_title  ON songs(title);
      CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);

      CREATE TABLE IF NOT EXISTS fetch_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        title     TEXT NOT NULL,
        artist    TEXT NOT NULL DEFAULT '',
        platform  TEXT,
        quality   TEXT,
        file_path TEXT,
        status    TEXT NOT NULL,
        message   TEXT,
        created_at INTEGER NOT NULL
      );

      -- 歌单：命名的可持久化队列（主页展示用）
      CREATE TABLE IF NOT EXISTS playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        cover      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        song_id     INTEGER NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        UNIQUE(playlist_id, song_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pl_items ON playlist_items(playlist_id);
    `);

    // 增量迁移：老库没有 cover 列。SQLite 的 ADD COLUMN 是幂等的写法需要
    // 先查 pragma，直接 ADD 会在第二次启动时报 duplicate column。
    const cols = this.db.prepare('PRAGMA table_info(songs)').all() as any[];
    if (!cols.some((c) => c.name === 'cover')) {
      this.db.exec('ALTER TABLE songs ADD COLUMN cover TEXT');
    }
  }

  /**
   * 从音频文件抽内嵌封面，落成 data/covers/<hash>.jpg。
   *
   * 为什么单独缓存而不是每次读音频：曲库列表一页 50 首，每首都去解析
   * 几十 MB 的 FLAC 标签会非常慢；抽一次存小图（通常几十 KB）后，
   * 列表直接用 `<img src="/cover/xxx.jpg">` 加载。
   */
  async extractCovers(limit = 500): Promise<number> {
    const cfg = loadConfig();
    const coverDir = path.join(cfg.dataDir, 'covers');
    try { fs.mkdirSync(coverDir, { recursive: true }); } catch { return 0; }

    // 只处理还没抽过的（cover 为 NULL）。
    // 注意：**不能用空串当「已处理」标记** —— 文件短暂不可读（正在写入 / 被移动）
    // 时会误判为「无封面」，之后永远不再重试。所以失败时就保持 NULL 等下次。
    //
    // 另外把历史遗留的空串也一并重试：早前版本因为漏了 await，把所有歌都
    // 标成了「无封面」，这批数据必须能自愈，否则老用户升级后依然全无封面。
    const rows = this.db.prepare(
      `SELECT id, file_path FROM songs
        WHERE cover IS NULL OR cover = ''
        ORDER BY (cover = '') ASC
        LIMIT ?`
    ).all(limit) as any[];
    if (rows.length === 0) return 0;

    let done = 0;
    for (const r of rows) {
      const abs = path.resolve(cfg.musicDir, r.file_path);
      try {
        if (!fs.existsSync(abs)) continue;          // 文件不在 → 留 NULL，下轮再看
        // parseFile 是**异步**的：早前这里漏了 await，拿到的是 Promise，
        // `md.common` 恒为 undefined，于是每首歌都被判成「无封面」。
        const md = await parseFile(abs, { duration: false });
        const pic = md?.common?.picture?.[0];
        if (!pic?.data) {
          // 确实没有内嵌封面：写空串占位，避免每次扫描都重新解析
          this.db.prepare('UPDATE songs SET cover = ? WHERE id = ?').run('', r.id);
          continue;
        }
        const ext = pic.format === 'image/png' ? 'png' : 'jpg';
        const name = createHash('sha1').update(r.file_path).digest('hex').slice(0, 16) + '.' + ext;
        fs.writeFileSync(path.join(coverDir, name), pic.data);
        this.db.prepare('UPDATE songs SET cover = ? WHERE id = ?').run(name, r.id);
        done++;
      } catch (e) {
        // 解析失败：保持 NULL 以便下次重试，不写空串（否则永久失去封面）
        logger.debug({ file: r.file_path, err: String(e).slice(0, 120) }, '封面提取失败，下次重试');
      }
    }
    if (done > 0) logger.info({ extracted: done }, '封面提取完成');
    return done;
  }

  /** 扫描音乐目录，增量入库 */
  async scan(): Promise<{ added: number; total: number }> {
    const cfg = loadConfig();
    const exts = ['.flac', '.mp3', '.m4a', '.wav', '.ape', '.ogg', '.opus'];
    let added = 0;

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!exts.includes(path.extname(e.name).toLowerCase())) continue;

        const rel = path.relative(cfg.musicDir, full);
        const exists = this.db.prepare('SELECT id FROM songs WHERE file_path = ?').get(rel);
        if (exists) continue;

        // 从文件名推断： "歌手 - 歌名.flac"
        const base = path.basename(e.name, path.extname(e.name));
        let artist = '';
        let title = base;
        const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if (m) { artist = m[1].trim(); title = m[2].trim(); }

        // 目录结构 {artist}/{album}/... 时优先取目录
        const parts = rel.split(path.sep);
        if (parts.length >= 3) {
          artist = artist || parts[parts.length - 3];
        }
        const album = parts.length >= 2 ? parts[parts.length - 2] : '';

        // 用 run() 返回的 changes 判断是否真插入。
        // 不能另起一句 SELECT changes() —— 中间可能有别的语句把计数冲掉。
        const info = this.db.prepare(
          'INSERT OR IGNORE INTO songs (title, artist, album, file_path, duration, added_at) VALUES (?,?,?,?,?,?)'
        ).run(title, artist, album, rel, null, Date.now());
        if (info.changes > 0) added++;
      }
    };

    walk(cfg.musicDir);
    // 抽封面：内嵌封面转成独立小图缓存，供界面直接展示。
    // 放在扫描之后统一做，避免在 walk 里同步读大文件拖慢扫描。
    // 这一步是异步的（要 await parseFile），所以 scan 本身也是 async。
    await this.extractCovers();
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM songs').get() as any).c;
    logger.info({ added, total }, '曲库扫描完成');
    return { added, total };
  }

  /** 按歌名+歌手检索本地曲库 */
  find(title: string, artist?: string): LibrarySong | null {
    const rows = this.db.prepare(
      `SELECT * FROM songs WHERE title LIKE ? ${artist ? 'AND artist LIKE ?' : ''} LIMIT 20`
    ).all(...(artist ? [`%${title}%`, `%${artist}%`] : [`%${title}%`])) as any[];
    if (rows.length === 0) return null;

    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_（）()《》·]/g, '');
    const nt = norm(title);
    let best = rows[0];
    let bestScore = -1;
    for (const r of rows) {
      const st = norm(r.title).includes(nt) || nt.includes(norm(r.title)) ? 1 : 0.5;
      const sa = artist ? (norm(r.artist).includes(norm(artist)) ? 1 : 0.3) : 0.5;
      const sc = st * 2 + sa;
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    return this.row(best);
  }

  list(limit = 50, offset = 0): LibrarySong[] {
    const rows = this.db.prepare(
      'SELECT * FROM songs ORDER BY added_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as any[];
    return rows.map((r) => this.row(r));
  }

  /**
   * 关键词检索（歌名 / 歌手 / 专辑任一命中）。
   *
   * 用 LIKE 而非 FTS：曲库规模在个人场景下通常几千到几万条，
   * LIKE 配合 title/artist 上的索引完全够用，且不必维护额外的 FTS 表
   * 与触发器（那会显著增加迁移复杂度）。数据量大到需要 FTS 时再说。
   */
  search(keyword: string, limit = 50, offset = 0): LibrarySong[] {
    if (!keyword) return this.list(limit, offset);
    const like = `%${keyword}%`;
    const rows = this.db.prepare(
      `SELECT * FROM songs
        WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
        ORDER BY added_at DESC LIMIT ? OFFSET ?`
    ).all(like, like, like, limit, offset) as any[];
    return rows.map((r) => this.row(r));
  }

  /** 关键词命中总数（分页用） */
  countSearch(keyword: string): number {
    if (!keyword) return this.count();
    const like = `%${keyword}%`;
    return (this.db.prepare(
      `SELECT COUNT(*) AS c FROM songs
        WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?`
    ).get(like, like, like) as any).c;
  }

  /**
   * 删除曲库条目：把音频与同名 .lrc 移入 `<dataDir>/_trash/`，并移除索引。
   *
   * 为什么是移入回收站而不是硬删：这是用户自己的音乐文件，
   * 一次误点就永久丢失代价太大。回收站里按月归档，想恢复随时能拿回去。
   */
  remove(relPath: string): { ok: boolean; error?: string; moved?: string[] } {
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    const abs = path.resolve(root, relPath);

    // 防目录穿越：必须仍在音乐库内
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return { ok: false, error: '路径越界，已拒绝' };
    }
    if (!fs.existsSync(abs)) {
      // 文件已经不在了（外部删除），顺手清索引
      this.db.prepare('DELETE FROM songs WHERE file_path = ?').run(relPath);
      return { ok: true, moved: [] };
    }

    try {
      const trash = path.join(cfg.dataDir, '_trash', new Date().toISOString().slice(0, 7));
      fs.mkdirSync(trash, { recursive: true });

      const moved: string[] = [];
      const targets = [abs];
      // 同名歌词文件一并回收
      const lrc = abs.replace(/\.[^.]+$/, '') + '.lrc';
      if (fs.existsSync(lrc)) targets.push(lrc);

      for (const t of targets) {
        const dest = path.join(trash, path.basename(t));
        // 同名冲突时加时间戳后缀，避免覆盖回收站里已有的文件
        const finalDest = fs.existsSync(dest)
          ? path.join(trash, `${Date.now()}__${path.basename(t)}`)
          : dest;
        fs.renameSync(t, finalDest);
        moved.push(finalDest);
      }

      this.db.prepare('DELETE FROM songs WHERE file_path = ?').run(relPath);
      logger.info({ file: relPath, moved: moved.length }, '曲库条目已移入回收站');
      return { ok: true, moved };
    } catch (e) {
      logger.warn({ file: relPath, err: String(e) }, '删除曲库条目失败');
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  /** 曲库统计：总量、歌手数、专辑数、最近入库量 */
  stats(): { total: number; artists: number; albums: number; addedToday: number } {
    const total = this.count();
    const artists = (this.db.prepare(
      "SELECT COUNT(DISTINCT artist) AS c FROM songs WHERE artist <> ''"
    ).get() as any).c;
    const albums = (this.db.prepare(
      "SELECT COUNT(DISTINCT artist || '/' || album) AS c FROM songs WHERE album <> ''"
    ).get() as any).c;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const addedToday = (this.db.prepare(
      'SELECT COUNT(*) AS c FROM songs WHERE added_at >= ?'
    ).get(dayStart.getTime()) as any).c;
    return { total, artists, albums, addedToday };
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM songs').get() as any).c;
  }

  /**
   * 找出「索引里有、磁盘上已经没了」的曲目。
   * 用户在 ToneCore 之外直接用资源管理器删掉 mp3 时，索引不会自动同步，
   * 于是曲库里留下点不开的幽灵条目 —— 这就是它们的来源。
   */
  missingSongs(): { id: number; title: string; artist: string; filePath: string }[] {
    const cfg = loadConfig();
    const rows = this.db.prepare('SELECT id, title, artist, file_path FROM songs').all() as any[];
    const gone: { id: number; title: string; artist: string; filePath: string }[] = [];
    for (const r of rows) {
      const abs = path.resolve(cfg.musicDir, r.file_path);
      if (!fs.existsSync(abs)) gone.push({ id: r.id, title: r.title, artist: r.artist, filePath: r.file_path });
    }
    return gone;
  }

  /**
   * 清理已在磁盘上消失的曲目。
   *
   * 必须同时清 `playlist_items`：这些歌可能还在某个歌单里，
   * 只删 songs 会让歌单留下永远播放不了的条目（歌曲 JOIN 不到）。
   */
  pruneMissing(): { ok: boolean; removed: number; files: string[]; playlistsAffected: number } {
    const gone = this.missingSongs();
    if (!gone.length) return { ok: true, removed: 0, files: [], playlistsAffected: 0 };

    // 先记下受影响的歌单，删完要重算它们的封面
    const ids = gone.map((g) => g.id);
    const marks = ids.map(() => '?').join(',');
    const affected = this.db
      .prepare(`SELECT DISTINCT playlist_id AS pid FROM playlist_items WHERE song_id IN (${marks})`)
      .all(...ids) as any[];

    const delSong = this.db.prepare('DELETE FROM songs WHERE id = ?');
    const delItems = this.db.prepare('DELETE FROM playlist_items WHERE song_id = ?');
    const tx = this.db.transaction((list: number[]) => {
      for (const id of list) { delItems.run(id); delSong.run(id); }
    });
    tx(ids);

    for (const a of affected) this.updatePlaylistCover(a.pid);

    logger.info({ removed: gone.length, playlists: affected.length }, '已清理磁盘上消失的曲目');
    return {
      ok: true,
      removed: gone.length,
      files: gone.map((g) => g.filePath),
      playlistsAffected: affected.length,
    };
  }

  /** 取全部曲目（Subsonic 兼容层要把曲库聚合成 歌手→专辑→歌曲 的三级结构） */
  listAll(limit = 100000, offset = 0): LibrarySong[] {
    return this.list(limit, offset);
  }

  /** 按 id 精确取一首（SongLoft 兼容层按 id 访问时要） */
  findById(id: number): LibrarySong | null {
    const r = this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as any;
    return r ? this.row(r) : null;
  }

  /** 按路径精确取一首（单首刮削时用） */
  findByPath(relPath: string): LibrarySong | null {
    const r = this.db.prepare('SELECT * FROM songs WHERE file_path = ?').get(relPath) as any;
    return r ? this.row(r) : null;
  }

  // ============ 歌单（命名的可持久化队列） ============

  /** 列出所有歌单（含曲目数），按创建时间倒序 */
  listPlaylists(): { id: number; name: string; cover?: string; count: number; createdAt: number }[] {
    const rows = this.db.prepare(
      `SELECT p.id, p.name, p.cover, p.created_at,
              (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id) AS cnt
       FROM playlists p ORDER BY p.created_at DESC`
    ).all() as any[];
    return rows.map((r) => ({
      id: r.id, name: r.name, cover: r.cover || undefined,
      count: r.cnt, createdAt: r.created_at,
    }));
  }

  createPlaylist(name: string): { id: number; name: string } {
    const n = (name || '').trim() || '新歌单';
    const info = this.db.prepare('INSERT INTO playlists (name, created_at) VALUES (?,?)').run(n, Date.now());
    return { id: Number(info.lastInsertRowid), name: n };
  }

  deletePlaylist(id: number): { ok: boolean } {
    this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    return { ok: true };
  }

  /** 取歌单及其曲目（曲目按 position 升序） */
  getPlaylist(id: number): { id: number; name: string; cover?: string; tracks: LibrarySong[] } | null {
    const p = this.db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as any;
    if (!p) return null;
    const items = this.db.prepare(
      `SELECT s.* FROM playlist_items pi JOIN songs s ON s.id = pi.song_id
       WHERE pi.playlist_id = ? ORDER BY pi.position ASC, pi.id ASC`
    ).all(id) as any[];
    return { id: p.id, name: p.name, cover: p.cover || undefined, tracks: items.map((r: any) => this.row(r)) };
  }

  addToPlaylist(id: number, songId: number): { ok: boolean; error?: string } {
    const exists = this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id);
    if (!exists) return { ok: false, error: '歌单不存在' };
    const cnt = (this.db.prepare('SELECT COUNT(*) AS c FROM playlist_items WHERE playlist_id = ?').get(id) as any).c;
    this.db.prepare(
      'INSERT OR IGNORE INTO playlist_items (playlist_id, song_id, position) VALUES (?,?,?)'
    ).run(id, songId, cnt);
    this.updatePlaylistCover(id);
    return { ok: true };
  }

  removeFromPlaylist(id: number, songId: number): { ok: boolean } {
    this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND song_id = ?').run(id, songId);
    this.updatePlaylistCover(id);
    return { ok: true };
  }

  /** 歌单封面取第一首有封面的曲目（无则清空） */
  private updatePlaylistCover(id: number) {
    const first = this.db.prepare(
      `SELECT s.cover FROM playlist_items pi JOIN songs s ON s.id = pi.song_id
       WHERE pi.playlist_id = ? AND s.cover IS NOT NULL AND s.cover <> ''
       ORDER BY pi.position ASC, pi.id ASC LIMIT 1`
    ).get(id) as any;
    this.db.prepare('UPDATE playlists SET cover = ? WHERE id = ?').run(first?.cover || null, id);
  }

  /** 单首重新抽封面（刮削写入标签后刷新缓存图） */
  async extractCoverFor(relPath: string): Promise<void> {
    const r = this.db.prepare('SELECT id FROM songs WHERE file_path = ?').get(relPath) as any;
    if (!r) return;
    const abs = path.resolve(loadConfig().musicDir, relPath);
    try {
      if (!fs.existsSync(abs)) {
        this.db.prepare('UPDATE songs SET cover = ? WHERE id = ?').run('', r.id);
        return;
      }
      const md = await parseFile(abs, { duration: false });
      const pic = md?.common?.picture?.[0];
      if (!pic?.data) {
        this.db.prepare('UPDATE songs SET cover = ? WHERE id = ?').run('', r.id);
        return;
      }
      const ext = pic.format === 'image/png' ? 'png' : 'jpg';
      const name = createHash('sha1').update(relPath).digest('hex').slice(0, 16) + '.' + ext;
      const coverDir = path.join(loadConfig().dataDir, 'covers');
      try { fs.mkdirSync(coverDir, { recursive: true }); } catch { /* 已存在 */ }
      fs.writeFileSync(path.join(coverDir, name), pic.data);
      this.db.prepare('UPDATE songs SET cover = ? WHERE id = ?').run(name, r.id);
    } catch {
      // 解析失败：保持现状，下轮扫描再试
    }
  }

  log(entry: { title: string; artist: string; platform?: string; quality?: string; filePath?: string; status: string; message?: string }) {
    this.db.prepare(
      'INSERT INTO fetch_log (title, artist, platform, quality, file_path, status, message, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(entry.title, entry.artist, entry.platform ?? null, entry.quality ?? null,
      entry.filePath ?? null, entry.status, entry.message ?? null, Date.now());
  }

  recentLogs(limit = 50): any[] {
    return this.db.prepare('SELECT * FROM fetch_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  private row(r: any): LibrarySong {
    return {
      id: r.id, title: r.title, artist: r.artist, album: r.album,
      filePath: r.file_path, duration: r.duration, addedAt: r.added_at,
      cover: r.cover || undefined,
    };
  }

  /** 按封面缓存文件名取绝对路径（供 /cover/:name 路由用） */
  coverPath(name: string): string | null {
    // 只允许纯文件名，挡住目录穿越（封面名是我们自己生成的 sha1，不含路径分隔符）
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
    const abs = path.join(loadConfig().dataDir, 'covers', name);
    return fs.existsSync(abs) ? abs : null;
  }
}
