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
  /** 昵称：界面显示用，可与登录名不同 */
  nickname: string;
  createdAt: number;
}

/** 播放进度：跨设备续播的依据 */
export interface PlayProgress {
  songId: number | null;
  title: string;
  artist: string;
  album: string;
  /** 已播放毫秒数 */
  positionMs: number;
  /** 曲目总时长（毫秒），用于算百分比 */
  durationMs: number;
  updatedAt: number;
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
        nickname      TEXT NOT NULL DEFAULT '',
        -- Subsonic 令牌认证需要 md5(明文密码+salt)，故用对称加密存一份密码副本（仅此用途）
        pwd_enc       TEXT NOT NULL DEFAULT '',
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

      -- 播放进度：记住每首歌播到哪儿（跨设备续播的依据）
      CREATE TABLE IF NOT EXISTS play_progress (
        username    TEXT NOT NULL,
        song_key    TEXT NOT NULL,
        song_id     INTEGER,
        title       TEXT NOT NULL DEFAULT '',
        artist      TEXT NOT NULL DEFAULT '',
        album       TEXT NOT NULL DEFAULT '',
        position_ms INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (username, song_key)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_time ON play_progress(username, updated_at DESC);

      -- 键值设置：界面偏好等（按用户维度持久化）
      CREATE TABLE IF NOT EXISTS user_settings (
        username   TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (username, key)
      );
    `);

    // 增量迁移：老库没有 nickname 列（SQLite 的 ADD COLUMN 不幂等，先查 pragma）
    const ucols = this.db.prepare('PRAGMA table_info(users)').all() as any[];
    if (!ucols.some((c) => c.name === 'nickname')) {
      this.db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
      logger.info('已为 users 表补充 nickname 列');
    }
    if (!ucols.some((c) => c.name === 'pwd_enc')) {
      this.db.exec("ALTER TABLE users ADD COLUMN pwd_enc TEXT NOT NULL DEFAULT ''");
      logger.info('已为 users 表补充 pwd_enc 列');
    }
  }

  /**
   * 首次启动写入管理员账号。
   *
   * 口径（按用户要求）：**只用固定的默认值初始化，不被环境变量覆盖**。
   * 之后一切以数据库为准 —— 用户可在设置页自行修改账号 / 密码 / 昵称。
   * 这样重启不会把用户改过的凭据刷回默认值。
   */
  private ensureAdmin(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c;
    if (count > 0) return;
    this.createUser(DEFAULT_USERNAME, DEFAULT_PASSWORD, '管理员');
    logger.info({ user: DEFAULT_USERNAME }, '已创建初始管理员账号（默认，可在设置页修改）');
  }

  private hash(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  createUser(username: string, password: string, nickname = ''): AuthUser {
    const salt = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const info = this.db.prepare(
      'INSERT INTO users (username, password_hash, salt, nickname, pwd_enc, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(username, this.hash(password, salt), salt, nickname || username, this.encryptPassword(password), now, now);
    return { id: Number(info.lastInsertRowid), username, nickname: nickname || username, createdAt: now };
  }

  private toUser(row: any): AuthUser {
    return { id: row.id, username: row.username, nickname: row.nickname || row.username, createdAt: row.created_at };
  }

  /** 校验账号密码；成功返回用户，失败返回 null */
  verify(username: string, password: string): AuthUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!row) return null;
    const got = Buffer.from(this.hash(password, row.salt), 'hex');
    const want = Buffer.from(row.password_hash, 'hex');
    // 定长比较，避免时序侧信道
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    return this.toUser(row);
  }

  /** 仅校验密码（不改任何东西），供 Subsonic 的 p= 明文/enc: 认证使用 */
  checkPassword(username: string, password: string): AuthUser | null {
    return this.verify(username, password);
  }

  /**
   * Subsonic 令牌认证：客户端给的是 md5(password + salt)，服务端手上只有密码哈希，
   * 无法反推。但要真实验证，必须能算出 md5(明文密码 + salt)。
   *
   * 做法：把「明文密码的 md5 中间态」也存一份（`pwd_md5`），
   * 校验时算 md5(存着的明文md5? 不行 —— md5(pw+salt) 无法由 md5(pw) 推出)。
   * 因此这里必须存明文等价物。折中且安全的做法：
   * 用可逆的对称加密（AES-256-GCM）保存密码副本，密钥来自 JWT secret，
   * 仅用于 Subsonic 令牌校验；主认证仍走 scrypt 哈希，不依赖这份副本。
   */
  verifyTokenStyle(username: string, token: string, salt: string): AuthUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!row) return null;
    const plain = this.decryptPassword(row.pwd_enc);
    if (!plain) return null;
    const expect = crypto.createHash('md5').update(plain + salt).digest('hex');
    if (expect !== String(token).toLowerCase()) return null;
    return this.toUser(row);
  }

  /** 用 JWT 密钥派生的对称密钥加解密「Subsonic 用密码副本」 */
  private pwdKey(): Buffer {
    return crypto.createHash('sha256').update(this.secret + '|subsonic-pwd').digest();
  }

  private encryptPassword(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.pwdKey(), iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  }

  private decryptPassword(blob: string | null): string | null {
    if (!blob) return null;
    try {
      const raw = Buffer.from(blob, 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const data = raw.subarray(28);
      const dec = crypto.createDecipheriv('aes-256-gcm', this.pwdKey(), iv);
      dec.setAuthTag(tag);
      return Buffer.concat([dec.update(data), dec.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** 修改昵称 */
  setNickname(username: string, nickname: string): boolean {
    const r = this.db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE username = ?')
      .run(nickname || username, Date.now(), username);
    return r.changes > 0;
  }

  /**
   * 修改账号名（登录名）。
   * 同步迁移所有以旧名为主键的数据，避免「改了名，历史/进度全丢」。
   */
  setUsername(oldName: string, newName: string): { ok: boolean; error?: string } {
    const n = String(newName || '').trim();
    if (!n) return { ok: false, error: '新账号名不能为空' };
    if (n === oldName) return { ok: true };
    const dup = this.db.prepare('SELECT id FROM users WHERE username = ?').get(n) as any;
    if (dup) return { ok: false, error: '该账号名已被占用' };
    try {
      const tx = this.db.transaction(() => {
        this.db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE username = ?').run(n, Date.now(), oldName);
        this.db.prepare('UPDATE auth_tokens SET username = ? WHERE username = ?').run(n, oldName);
        this.db.prepare('UPDATE play_progress SET username = ? WHERE username = ?').run(n, oldName);
        this.db.prepare('UPDATE user_settings SET username = ? WHERE username = ?').run(n, oldName);
      });
      tx();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  /** 修改密码（改完吊销该用户所有 token） */
  setPassword(username: string, password: string): boolean {
    const salt = crypto.randomBytes(16).toString('hex');
    const r = this.db.prepare(
      'UPDATE users SET password_hash = ?, salt = ?, pwd_enc = ?, updated_at = ? WHERE username = ?',
    ).run(this.hash(password, salt), salt, this.encryptPassword(password), Date.now(), username);
    if (r.changes > 0) this.revokeAll(username);
    return r.changes > 0;
  }

  /** 一次性改账号资料（账号名 / 密码 / 昵称） */
  updateProfile(oldName: string, patch: { username?: string; password?: string; nickname?: string }):
    { ok: boolean; error?: string; username?: string } {
    let current = oldName;
    if (patch.username && patch.username !== oldName) {
      const r = this.setUsername(oldName, patch.username);
      if (!r.ok) return r;
      current = patch.username.trim();
    }
    if (typeof patch.nickname === 'string') this.setNickname(current, patch.nickname.trim());
    if (patch.password) {
      if (patch.password.length < 4) return { ok: false, error: '密码至少 4 位' };
      this.setPassword(current, patch.password);
    }
    return { ok: true, username: current };
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
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(p.sub) as any;
    return row ? this.toUser(row) : null;
  }

  listUsers(): AuthUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as any[]).map((r) => this.toUser(r));
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

  // ==================== 播放进度（跨设备续播） ====================

  /** 进度用「路径或 id」做键：同一首歌无论从哪个入口都应命中同一条 */
  private progressKey(songKey: string | number): string {
    return String(songKey);
  }

  saveProgress(username: string, p: {
    songKey: string | number; songId?: number | null;
    title?: string; artist?: string; album?: string;
    positionMs: number; durationMs?: number;
  }): void {
    this.db.prepare(`
      INSERT INTO play_progress (username, song_key, song_id, title, artist, album, position_ms, duration_ms, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(username, song_key) DO UPDATE SET
        position_ms = excluded.position_ms,
        duration_ms = excluded.duration_ms,
        song_id     = excluded.song_id,
        title       = excluded.title,
        artist      = excluded.artist,
        album       = excluded.album,
        updated_at  = excluded.updated_at
    `).run(
      username, this.progressKey(p.songKey), p.songId ?? null,
      p.title || '', p.artist || '', p.album || '',
      Math.max(0, Math.round(p.positionMs || 0)),
      Math.max(0, Math.round(p.durationMs || 0)),
      Date.now(),
    );
  }

  /** 取某首歌的进度（用于「上次播到哪儿」） */
  getProgress(username: string, songKey: string | number): PlayProgress | null {
    const r = this.db.prepare('SELECT * FROM play_progress WHERE username = ? AND song_key = ?')
      .get(username, this.progressKey(songKey)) as any;
    if (!r) return null;
    return {
      songId: r.song_id, title: r.title, artist: r.artist, album: r.album,
      positionMs: r.position_ms, durationMs: r.duration_ms, updatedAt: r.updated_at,
    };
  }

  /** 最近播放（带进度）—— 客户端启动时用它恢复「继续收听」 */
  recentProgress(username: string, limit = 20): PlayProgress[] {
    return (this.db.prepare(
      'SELECT * FROM play_progress WHERE username = ? ORDER BY updated_at DESC LIMIT ?',
    ).all(username, Math.max(1, Math.min(200, limit))) as any[]).map((r) => ({
      songId: r.song_id, title: r.title, artist: r.artist, album: r.album,
      positionMs: r.position_ms, durationMs: r.duration_ms, updatedAt: r.updated_at,
    }));
  }

  clearProgress(username: string, songKey: string | number): void {
    this.db.prepare('DELETE FROM play_progress WHERE username = ? AND song_key = ?')
      .run(username, this.progressKey(songKey));
  }

  // ==================== 用户设置（KV） ====================

  getSetting(username: string, key: string): string | null {
    const r = this.db.prepare('SELECT value FROM user_settings WHERE username = ? AND key = ?')
      .get(username, key) as any;
    return r ? r.value : null;
  }

  setSetting(username: string, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO user_settings (username, key, value, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(username, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(username, key, String(value ?? ''), Date.now());
  }

  allSettings(username: string): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM user_settings WHERE username = ?').all(username) as any[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}
