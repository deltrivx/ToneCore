import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

/**
 * 账号认证与令牌服务。
 *
 * 设计口径（与 SongLoft 对齐，便于「其他设备按 SongLoft 方式连接」）：
 *   - 账号来源：**环境变量优先，未设置则用默认**
 *       TONECORE_ADMIN_USER      默认 admin
 *       TONECORE_ADMIN_PASSWORD  默认 password
 *     首次启动写入 SQLite，之后以库为准（避免每次重启把用户改的密码刷回去）。
 *   - 令牌：自签 HMAC-SHA256 的 JWT（不引第三方库），同时下发
 *     access_token / refresh_token / expires_in / token_type，
 *     字段名与 SongLoft 的 /api/v1/auth/login 响应完全一致。
 */
export interface AuthUser {
  id: number;
  username: string;
  createdAt: number;
}

interface TokenPayload {
  sub: string;
  /** access | refresh */
  typ: string;
  /** 客户端标识（JWT 里叫 client_id，与 SongLoft 保持一致） */
  client_id: string;
  iat: number;
  exp: number;
  jti: string;
}

const ACCESS_TTL_SEC = 7 * 24 * 3600;   // 与 SongLoft 实测一致（604799 秒 ≈ 7 天）
const REFRESH_TTL_SEC = 30 * 24 * 3600;

/** 默认账号（环境变量未设置时使用） */
export const DEFAULT_USERNAME = 'admin';
export const DEFAULT_PASSWORD = 'password';

export class AuthService {
  private db: Database.Database;
  private secret: string;

  constructor(dbFile?: string, secret?: string) {
    const cfg = loadConfig();
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    this.db = new Database(dbFile || path.join(cfg.dataDir, 'tonecore.db'));
    this.db.pragma('journal_mode = WAL');
    // 签名密钥：优先环境变量，其次落盘持久化（重启后 token 仍然有效）
    this.secret = secret || process.env.TONECORE_JWT_SECRET || this.loadOrCreateSecret();
    this.migrate();
    this.ensureAdmin();
  }

  private loadOrCreateSecret(): string {
    const cfg = loadConfig();
    const f = path.join(cfg.dataDir, 'jwt-secret');
    try {
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
      const s = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(f, s, { mode: 0o600 });
      return s;
    } catch {
      return crypto.randomBytes(32).toString('hex');
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt          TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      -- 令牌表：除了 JWT 自校验，还能记录签发/吊销（登出即吊销）
      CREATE TABLE IF NOT EXISTS auth_tokens (
        jti        TEXT PRIMARY KEY,
        username   TEXT NOT NULL,
        typ        TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_exp ON auth_tokens(expires_at);

      -- 播放历史（协议层 /api/v1/play-history 要用，且是「最近播放」的数据源）
      CREATE TABLE IF NOT EXISTS play_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id    INTEGER,
        title      TEXT NOT NULL DEFAULT '',
        artist     TEXT NOT NULL DEFAULT '',
        album      TEXT NOT NULL DEFAULT '',
        source     TEXT,
        played_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_time ON play_history(played_at);
    `);
  }

  /** 首次启动写入管理员账号。环境变量存在时用于初始化，之后以库为准 */
  private ensureAdmin(): void {
    const u = process.env.TONECORE_ADMIN_USER || DEFAULT_USERNAME;
    const p = process.env.TONECORE_ADMIN_PASSWORD || DEFAULT_PASSWORD;
    const exist = this.db.prepare('SELECT id FROM users WHERE username = ?').get(u) as any;
    if (exist) return;
    // 库里一个用户都没有 → 用（环境变量或默认）创建
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c;
    if (count > 0) {
      logger.info({ user: u }, '已有其它账号，跳过默认管理员创建');
      return;
    }
    this.createUser(u, p);
    logger.info(
      { user: u, fromEnv: !!(process.env.TONECORE_ADMIN_USER || process.env.TONECORE_ADMIN_PASSWORD) },
      '已创建初始管理员账号',
    );
  }

  private hash(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  createUser(username: string, password: string): AuthUser {
    const salt = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const info = this.db.prepare(
      'INSERT INTO users (username, password_hash, salt, created_at, updated_at) VALUES (?,?,?,?,?)',
    ).run(username, this.hash(password, salt), salt, now, now);
    return { id: Number(info.lastInsertRowid), username, createdAt: now };
  }

  /** 校验账号密码；成功返回用户，失败返回 null */
  verify(username: string, password: string): AuthUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!row) return null;
    const got = Buffer.from(this.hash(password, row.salt), 'hex');
    const want = Buffer.from(row.password_hash, 'hex');
    // 定长比较，避免时序侧信道
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    return { id: row.id, username: row.username, createdAt: row.created_at };
  }

  /** 修改密码（改完吊销该用户所有 token） */
  setPassword(username: string, password: string): boolean {
    const salt = crypto.randomBytes(16).toString('hex');
    const r = this.db.prepare(
      'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE username = ?',
    ).run(this.hash(password, salt), salt, Date.now(), username);
    if (r.changes > 0) this.revokeAll(username);
    return r.changes > 0;
  }

  private b64u(b: Buffer | string): string {
    const buf = typeof b === 'string' ? Buffer.from(b, 'utf8') : b;
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private sign(payload: TokenPayload): string {
    const h = this.b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = this.b64u(JSON.stringify(payload));
    const data = `${h}.${p}`;
    const sig = this.b64u(crypto.createHmac('sha256', this.secret).update(data).digest());
    return `${data}.${sig}`;
  }

  private issue(username: string, typ: 'access' | 'refresh', ttl: number, clientId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomBytes(16).toString('hex');
    const token = this.sign({ sub: username, typ, client_id: clientId, iat: now, exp: now + ttl, jti });
    this.db.prepare(
      'INSERT INTO auth_tokens (jti, username, typ, created_at, expires_at) VALUES (?,?,?,?,?)',
    ).run(jti, username, typ, Date.now(), (now + ttl) * 1000);
    return token;
  }

  /**
   * 登录：返回体字段与 SongLoft 实测一致
   * `{ access_token, refresh_token, expires_in, token_type: 'Bearer' }`
   */
  login(username: string, password: string): {
    ok: boolean;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
  } {
    const u = this.verify(username, password);
    if (!u) return { ok: false, error: '用户名或密码错误' };
    const clientId = crypto.randomBytes(8).toString('hex');
    const access = this.issue(u.username, 'access', ACCESS_TTL_SEC, clientId);
    const refresh = this.issue(u.username, 'refresh', REFRESH_TTL_SEC, clientId);
    return {
      ok: true,
      access_token: access,
      refresh_token: refresh,
      expires_in: ACCESS_TTL_SEC - 1,
      token_type: 'Bearer',
    };
  }

  verifyToken(token: string, want: 'access' | 'refresh' = 'access'): TokenPayload | null {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const expect = this.b64u(crypto.createHmac('sha256', this.secret).update(data).digest());
    if (expect !== parts[2]) return null;
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    } catch { return null; }
    if (payload.typ !== want) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    const row = this.db.prepare('SELECT revoked FROM auth_tokens WHERE jti = ?').get(payload.jti) as any;
    if (row && row.revoked) return null;
    return payload;
  }

  refresh(refreshToken: string): { ok: boolean; access_token?: string; expires_in?: number; token_type?: string; error?: string } {
    const p = this.verifyToken(refreshToken, 'refresh');
    if (!p) return { ok: false, error: 'refresh_token 无效或已过期' };
    const access = this.issue(p.sub, 'access', ACCESS_TTL_SEC, p.client_id);
    return { ok: true, access_token: access, expires_in: ACCESS_TTL_SEC - 1, token_type: 'Bearer' };
  }

  revoke(token: string): void {
    const p = this.verifyToken(token, 'access') || this.verifyToken(token, 'refresh');
    if (p) this.db.prepare('UPDATE auth_tokens SET revoked = 1 WHERE jti = ?').run(p.jti);
  }

  revokeAll(username: string): void {
    this.db.prepare('UPDATE auth_tokens SET revoked = 1 WHERE username = ?').run(username);
  }

  /** 从 Authorization 头取用户（`Bearer xxx`） */
  userFromHeader(header?: string): AuthUser | null {
    const m = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
    if (!m) return null;
    const p = this.verifyToken(m[1], 'access');
    if (!p) return null;
    const row = this.db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(p.sub) as any;
    return row ? { id: row.id, username: row.username, createdAt: row.created_at } : null;
  }

  listUsers(): AuthUser[] {
    return (this.db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all() as any[])
      .map((r) => ({ id: r.id, username: r.username, createdAt: r.created_at }));
  }

  /** 记录一次播放（播放历史 / 最近播放） */
  recordPlay(s: { songId?: number | null; title?: string; artist?: string; album?: string; source?: string }): void {
    this.db.prepare(
      'INSERT INTO play_history (song_id, title, artist, album, source, played_at) VALUES (?,?,?,?,?,?)',
    ).run(s.songId ?? null, s.title || '', s.artist || '', s.album || '', s.source || null, Date.now());
  }

  history(limit = 50): any[] {
    return this.db.prepare(
      'SELECT id, song_id AS songId, title, artist, album, source, played_at AS playedAt FROM play_history ORDER BY played_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(500, limit)));
  }
}
