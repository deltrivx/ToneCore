import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
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
    `);
  }

  /** 扫描音乐目录，增量入库 */
  scan(): { added: number; total: number } {
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

        this.db.prepare(
          'INSERT OR IGNORE INTO songs (title, artist, album, file_path, duration, added_at) VALUES (?,?,?,?,?,?)'
        ).run(title, artist, album, rel, null, Date.now());
        if (this.db.prepare('SELECT changes() AS c').get() as any) added++;
      }
    };

    walk(cfg.musicDir);
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

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM songs').get() as any).c;
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
    };
  }
}
