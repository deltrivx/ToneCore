import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { eapiEncrypt, eapiDecrypt } from './crypto.js';

/**
 * 网易云客户端（eapi 通道，支持扫码登录）。
 *
 * 为什么走 eapi 而不是 weapi（实测结论，不是猜的）：
 *   本项目容器里 weapi（music.163.com/weapi/*）三条路
 *   ——unikey / 匿名注册 / 带匿名 cookie 的 unikey——**全部返回 HTTP 200 但空响应体**，
 *   拿不到任何数据。而 eapi（interface.music.163.com/eapi/*）实测全通：
 *     取链   → 拿到真实 URL（br 320000）
 *     歌单详情 → 热歌榜 200 首
 *     unikey  → 拿到真实 key
 *     扫码轮询 → 正确返回 801「等待扫码」
 *   因此登录、歌单、取链统一走 eapi。
 *
 * 算法参考飞牛音乐扩展所用的 NEMbox（NetEase-MusicBox）：
 *   **只参考算法与端点，不读取、不复用其任何登录态（cookie）**。
 *
 * 登录态：cookie 落盘到 dataDir/netease-cookie.json。
 *   ⚠️ 该文件含 MUSIC_U 等凭据，**绝不可输出到日志或接口**。
 */

const EAPI_BASE = 'https://interface.music.163.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 匿名设备上下文（NEMbox _ensure_anon_cookies 同款） */
const ANON_DEFAULTS: Record<string, string> = {
  os: 'pc',
  appver: '3.1.17.204416',
  osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
  channel: 'netease',
  __remember_me: 'true',
  WEVNSM: '1.0.0',
};

export interface NeteaseAccount {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  coverUrl?: string;
  trackCount: number;
}

export class NeteaseClient {
  private cookies = new Map<string, string>();
  private deviceId: string;
  private file: string;

  constructor() {
    const cfg = loadConfig();
    this.file = path.join(cfg.dataDir, 'netease-cookie.json');
    this.deviceId = 'tonecore-' + crypto.randomBytes(8).toString('hex');
    this.load();
    this.ensureAnonCookies();
  }

  // ---------- cookie 持久化 ----------

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (raw && typeof raw === 'object') {
          if (raw.deviceId) this.deviceId = String(raw.deviceId);
          delete raw.deviceId;
          this.cookies = new Map(Object.entries(raw as Record<string, string>));
        }
      }
    } catch (e) {
      logger.debug({ err: String(e) }, '网易 cookie 读取失败');
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify({ deviceId: this.deviceId, ...Object.fromEntries(this.cookies) }, null, 2),
        'utf8',
      );
    } catch (e) {
      logger.warn({ err: String(e) }, '网易 cookie 保存失败');
    }
  }

  /** 注入匿名设备上下文（任何请求之前的硬性前置条件） */
  private ensureAnonCookies(): void {
    const nuid = this.cookies.get('_ntes_nuid') || crypto.randomBytes(32).toString('hex');
    const rand6 = crypto.randomBytes(4).toString('hex').slice(0, 6);
    const defaults: Record<string, string> = {
      ...ANON_DEFAULTS,
      deviceId: this.deviceId,
      _ntes_nuid: nuid,
      _ntes_nnid: `${nuid},${Date.now()}`,
      WNMCID: this.cookies.get('WNMCID') || `${rand6}.${Date.now()}.01.0`,
    };
    for (const [k, v] of Object.entries(defaults)) {
      if (!this.cookies.has(k)) this.cookies.set(k, v);
    }
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorbSetCookie(raw: string | null): void {
    if (!raw) return;
    for (const part of raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
      const kv = part.split(';')[0];
      const i = kv.indexOf('=');
      if (i <= 0) continue;
      const name = kv.slice(0, i).trim();
      const value = kv.slice(i + 1).trim();
      // 服务端登出时会下发 "MUSIC_U=-"，必须视为清除而不是写入空值
      if (!name || !value || value === '-') continue;
      this.cookies.set(name, value);
    }
  }

  // ---------- 请求 ----------

  private async request<T = any>(apiPath: string, params: Record<string, unknown> = {}): Promise<T | null> {
    const uri = apiPath.startsWith('/api/') ? apiPath : `/api${apiPath}`;
    const payload = { ...params, e_r: true, header: { os: 'pc', deviceId: this.deviceId } };
    try {
      const res = await fetch(`${EAPI_BASE}/eapi/${uri.slice(5)}`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://music.163.com/',
          Cookie: this.cookieHeader(),
          Host: 'interface.music.163.com',
          'Accept-Encoding': 'identity',
        },
        body: `params=${eapiEncrypt(uri, payload)}`,
      });
      this.absorbSetCookie(res.headers.get('set-cookie'));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        logger.debug({ uri }, '网易 eapi 返回空体');
        return null;
      }
      const j = eapiDecrypt(buf);
      // 登录态变化后要落盘（扫码成功时服务端下发 cookie）
      if (this.isLoggedIn()) this.save();
      return j as T;
    } catch (e) {
      logger.debug({ uri: apiPath, err: String(e).slice(0, 120) }, '网易 eapi 请求失败');
      return null;
    }
  }

  // ---------- 登录 ----------

  /** 是否已登录（有 MUSIC_U 即视为已登录） */
  isLoggedIn(): boolean {
    return Boolean(this.cookies.get('MUSIC_U'));
  }

  /** 取二维码 unikey */
  async qrKey(): Promise<string | null> {
    const d = await this.request<{ code?: number; unikey?: string }>('/api/login/qrcode/unikey', { type: 3 });
    return d?.unikey || null;
  }

  /** 二维码内容（App 扫这个） */
  qrUrl(unikey: string): string {
    return `https://music.163.com/login?codekey=${unikey}`;
  }

  /**
   * 轮询扫码状态。
   * code 语义（与 NEMbox 一致）：800 过期 / 801 待扫码 / 802 待确认 / 803 成功
   */
  async qrCheck(unikey: string): Promise<{ code: number; message?: string }> {
    const d = await this.request<{ code?: number; message?: string; cookie?: string }>(
      '/api/login/qrcode/client/login',
      { type: 3, key: unikey },
    );
    if (!d) return { code: 0, message: '请求失败' };
    const code = Number(d.code ?? 0);
    // 803 成功：服务端会在响应体里给 cookie 串，直接吸收
    if (code === 803 && typeof d.cookie === 'string' && d.cookie) {
      for (const kv of d.cookie.split(';')) {
        const i = kv.indexOf('=');
        if (i <= 0) continue;
        const n = kv.slice(0, i).trim();
        const v = kv.slice(i + 1).trim();
        if (n && v && v !== '-') this.cookies.set(n, v);
      }
      this.save();
      logger.info('网易云扫码登录成功');
    }
    return { code, message: d.message };
  }

  /** 当前账号信息 */
  async account(): Promise<NeteaseAccount | null> {
    const d = await this.request<any>('/api/nuser/account/get');
    const profile = d?.profile;
    const account = d?.account;
    if (!profile && !account) return null;
    return {
      userId: account?.id ?? profile?.userId,
      nickname: profile?.nickname,
      avatarUrl: profile?.avatarUrl,
    };
  }

  /** 个人歌单列表 */
  async playlists(limit = 50): Promise<NeteasePlaylist[]> {
    const acc = await this.account();
    // uid 取不到时用 0：实测 uid=0 也能返回（内容不同），但登录后才有真实个人歌单
    const uid = acc?.userId ?? 0;
    const d = await this.request<any>('/api/user/playlist', { uid, offset: 0, limit });
    const list = d?.playlist;
    if (!Array.isArray(list)) return [];
    return list.map((p: any) => ({
      id: Number(p?.id ?? 0),
      name: String(p?.name ?? ''),
      coverUrl: p?.coverImgUrl ? String(p.coverImgUrl) : undefined,
      trackCount: Number(p?.trackCount ?? 0),
    })).filter((p: NeteasePlaylist) => p.id > 0 && p.name);
  }

  /** 歌单内曲目（返回 trackId 列表，需再取详情） */
  async playlistTrackIds(playlistId: number): Promise<number[]> {
    const d = await this.request<any>('/api/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
    const ids = d?.playlist?.trackIds;
    if (!Array.isArray(ids)) return [];
    return ids.map((t: any) => Number(t?.id ?? 0)).filter((n: number) => n > 0);
  }

  /** 曲目详情（批量） */
  async songDetails(ids: number[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const d = await this.request<any>('/api/v3/song/detail', {
      c: JSON.stringify(ids.map((id) => ({ id }))),
    });
    return Array.isArray(d?.songs) ? d.songs : [];
  }

  /**
   * 每日推荐（登录后为个性化；未登录是全网通用）。
   */
  async recommendSongs(): Promise<any[]> {
    const d = await this.request<any>('/api/v3/discovery/recommend/songs', {});
    const songs = d?.data?.dailySongs;
    return Array.isArray(songs) ? songs : [];
  }

  /**
   * 取链（登录后有机会拿到更高音质）。
   *
   * ⚠️ 实测：未登录时请求 lossless 会被**静默降级**成 exhigh(320k)，
   * 响应里 br/level 会如实反映。因此调用方应回读实际 br 判定音质，
   * 不要拿请求值当真实音质。
   */
  async songUrl(id: number, level = 'exhigh'): Promise<{ url: string; br: number; type: string; level: string } | null> {
    const d = await this.request<any>('/api/song/enhance/player/url/v1', {
      ids: JSON.stringify([id]),
      level,
      encodeType: level === 'lossless' ? 'flac' : 'mp3',
    });
    const it = d?.data?.[0];
    if (!it?.url) return null;
    return { url: String(it.url), br: Number(it.br ?? 0), type: String(it.type ?? ''), level: String(it.level ?? '') };
  }

  /** 退出登录：清掉本地 cookie */
  async logout(): Promise<void> {
    try {
      await this.request('/api/logout', {});
    } catch { /* 服务端登出失败也要清本地 */ }
    this.cookies.clear();
    this.ensureAnonCookies();
    this.save();
    logger.info('网易云已退出登录');
  }
}
