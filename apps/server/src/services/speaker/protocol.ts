import crypto from 'node:crypto';
import { logger } from '../../logger.js';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * 小爱音箱协议层（MiIO + Mina）。
 *
 * 参考实现：songloft-plugin-miot（Apache-2.0）
 * 两个通道：
 *  - MiIO  : 局域网直连（UDP 54321），用于设备发现与本地控制
 *  - Mina  : 小米云端 HTTP 接口，用于对话记录拉取与 TTS 下发
 */

// ---------- MiIO 协议常量 ----------
const MIIO_PORT = 54321;
const MIIO_HELLO = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

/** MiIO 包头：magic(2) + length(2) + unknown(4) + did(4) + stamp(4) + checksum(16) */
const MIIO_HEADER_LEN = 32;

export interface MiioDevice {
  did: string;
  ip: string;
  token: string;
  stamp: number;
}

/** 计算 MiIO 包校验和（全包 MD5，取前 16 字节） */
function miioChecksum(packet: Buffer): Buffer {
  return crypto.createHash('md5').update(packet).digest().subarray(0, 16);
}

/** 用 token 解密 MiIO 包体（AES-128-CBC，key=iv=token） */
export function miioDecrypt(packet: Buffer, token: Buffer): Buffer {
  const body = packet.subarray(MIIO_HEADER_LEN);
  if (body.length === 0) return Buffer.alloc(0);
  const decipher = crypto.createDecipheriv('aes-128-cbc', token, token);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** 用 token 加密 MiIO 包体 */
export function miioEncrypt(plain: Buffer, token: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-cbc', token, token);
  cipher.setAutoPadding(false);
  // PKCS#7 补齐到 16 字节
  const pad = 16 - (plain.length % 16);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

/** 组装 MiIO 握手包（hello） */
export function buildHello(did = 0xffffffff, stamp = 0xffffffff): Buffer {
  const pkt = Buffer.alloc(MIIO_HEADER_LEN);
  MIIO_HELLO.copy(pkt);
  pkt.writeUInt32BE(did >>> 0, 8);
  pkt.writeUInt32BE(stamp >>> 0, 12);
  miioChecksum(pkt).copy(pkt, 16);
  return pkt;
}

/** 构造 MiIO 命令包 */
export function buildCommand(device: MiioDevice, method: string, params: unknown[]): Buffer {
  const token = Buffer.from(device.token, 'hex');
  const payload = Buffer.from(JSON.stringify({ id: device.stamp, method, params }), 'utf8');
  const encrypted = miioEncrypt(payload, token);

  const header = Buffer.alloc(MIIO_HEADER_LEN);
  Buffer.from('21310020', 'hex').copy(header, 0);
  header.writeUInt16BE(MIIO_HEADER_LEN + encrypted.length, 2);
  header.writeUInt32BE(parseInt(device.did, 16) >>> 0 || 0, 8);
  header.writeUInt32BE(device.stamp >>> 0, 12);

  const pkt = Buffer.concat([header, encrypted]);
  miioChecksum(pkt).copy(pkt, 16);
  return pkt;
}

/** 解析 MiIO 响应 */
export function parseResponse(packet: Buffer, token: string): { method?: string; result?: unknown; error?: unknown } | null {
  const tk = Buffer.from(token, 'hex');
  const body = packet.subarray(MIIO_HEADER_LEN);
  if (body.length === 0) return null;
  try {
    const plain = miioDecrypt(packet, tk).toString('utf8').replace(/\x00+$/, '');
    return JSON.parse(plain);
  } catch (e) {
    logger.debug({ err: String(e) }, 'MiIO 响应解密失败');
    return null;
  }
}

// ---------- Mina 云端 API ----------

export interface MinaConfig {
  /** 登录后的 userId */
  userId: string;
  /** 服务 token */
  serviceToken: string;
  /** ssecurity（签名密钥） */
  ssecurity: string;
}

/** 登录所需的最少凭据（与 SongLoft MIoT 契约一致：只需账号 + 密码） */
export interface MiLoginCredentials {
  /** 小米账号（手机号 / 邮箱 / 小米 ID） */
  username: string;
  /** 账号密码 */
  password: string;
}

const MINA_LOGIN_BASE = "https://account.xiaomi.com";
const MI_LOGIN_UA =
  "MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103";

/** 小米登录响应里带 &&&START&&& 前缀，需剥掉后再解析 JSON */
function parseMiLoginBody(text: string): any {
  const i = text.indexOf("&&&START&&&");
  const body = i >= 0 ? text.slice(i + "&&&START&&&".length) : text;
  try { return JSON.parse(body); } catch { return { raw: body }; }
}

export interface MiLoginResult {
  ok: boolean;
  /** 需要短信 / 邮箱验证码时返回，配合 verifyMiLogin 完成 */
  needVerify?: { notificationUrl?: string; _sign?: string };
  /** 验证码是否已自动发送成功 */
  ticketSent?: boolean;
  ticketError?: string | null;
  /** 登录成功后可直接构造 MinaConfig */
  mina?: MinaConfig;
  /** 失败原因（用于前端展示） */
  error?: string;
  raw?: unknown;
}

/**
 * 步骤一：账号密码登录小米账号（对应 SongLoft 的 need_verify 分支）。
 * 成功直接拿到 serviceToken/ssecurity → 可直接用；需要验证码则返回 notificationUrl。
 */
export async function loginMiAccount(c: MiLoginCredentials): Promise<MiLoginResult> {
  // 关键：小米要求先走 authStart 拿登录上下文（context 即 _sign），
  // 缺少它会稳定返回 code=70016「登录验证失败」——与账号密码是否正确无关。
  let sign = "";
  try {
    const startRes = await fetch(
      `${MINA_LOGIN_BASE}/fe/service/identity/authStart?sid=micoapi&_locale=zh_CN`,
      {
        method: "GET",
        headers: {
          "User-Agent": MI_LOGIN_UA,
          "Accept": "application/json, text/plain, */*",
        },
      },
    );
    const startBody = parseMiLoginBody(await startRes.text());
    sign = String(startBody?.context ?? startBody?._sign ?? "");
  } catch (e) {
    logger.debug({ err: String(e) }, "authStart 获取登录上下文失败，继续尝试无 sign 登录");
  }

  // 实测：serviceParam / qs 同时存在会让小米返回 code=10001「系统错误」。
  // 只保留必需字段最稳（2026-09-21 参数二分法实测）。
  const params = new URLSearchParams({
    _json: "true",
    sid: "micoapi",
    user: c.username,
    // 小米要求密码为 MD5 大写，传明文会稳定返回 70016
    hash: crypto.createHash("md5").update(c.password).digest("hex").toUpperCase(),
  });
  if (sign) params.set("_sign", sign);

  const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLoginAuth2?_json=true`, {
    method: "POST",
    headers: {
      "User-Agent": MI_LOGIN_UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const j = parseMiLoginBody(await res.text());
  if (!j || typeof j !== "object") return { ok: false, error: "登录响应无法解析", raw: j };

  const userId = j.userId ? String(j.userId) : "";
  const ssecurity = String(j.ssecurity ?? "");
  const serviceToken = String(j.serviceToken ?? "");

  if (serviceToken && ssecurity && userId) {
    return { ok: true, mina: { userId, serviceToken, ssecurity } };
  }

  // 需要短信 / 邮箱验证码。
  // 关键：_sign 的真身是 notificationUrl 里的 context 参数（约 811 字符），
  // 它是「会话上下文」，必须原样回传给 serviceLoginAuth2 校验验证码。
  const notifUrl = String(j.notificationUrl ?? "");
  const needCode = notifUrl || j._sign;
  if (needCode) {
    let signToken = String(j._sign ?? "");
    if (!signToken && notifUrl) {
      try {
        const u = new URL(notifUrl);
        signToken = u.searchParams.get("context") ?? "";
      } catch {
        const m = notifUrl.match(/[?&]context=([^&]+)/);
        if (m) signToken = decodeURIComponent(m[1]);
      }
    }
    return {
      ok: false,
      needVerify: {
        notificationUrl: notifUrl,
        // 验证码校验用的会话签名
        _sign: signToken,
      },
      error: "需要短信/邮箱验证码",
      raw: j,
    };
  }

  const code = Number(j.code ?? 0);
  return {
    ok: false,
    error: describeLoginCode(code, String(j.desc ?? j.description ?? "")),
    raw: j,
  };
}

/** 把小米错误码翻成人能看懂的一句话 */
export function describeLoginCode(code: number, desc: string): string {
  // code=0 是小米的「成功」标志，绝不能当成错误信息抛出去
  // （否则 desc="成功" 会被前端拼成「验证失败：成功」）
  if (code === 0) return "";

  const table: Record<number, string> = {
    70016: "登录验证失败：账号密码不匹配或登录上下文缺失",
    70002: "账号或密码错误",
    70003: "需要人机验证（验证码 / 滑块）",
    70004: "登录次数过多，已限流，请稍后再试",
    70005: "账号被锁定，请前往小米账号中心解锁",
    70011: "需要短信二次验证",
    70014: "该账号未绑定手机或邮箱",
    87001: "验证码错误或已过期",
    87002: "验证码错误或已过期",
    87003: "验证码错误次数过多，请重新获取",
  };
  if (table[code]) return table[code];
  // 小米的 desc 有时是「成功」「ok」这类无信息量的词，不能当错误用
  const d = (desc || "").trim();
  if (d && !/^(成功|ok|OK|success)$/i.test(d)) return `${d}（code=${code}）`;
  return `登录失败（code=${code}）`;
}

/** 步骤二：提交短信 / 邮箱验证码完成登录 */
/**
 * 触发小米发送短信 / 邮箱验证码。
 *
 * 背景：serviceLoginAuth2 返回 need_verify 只表示「需要验证」，
 * 短信并不会自动发出。必须访问 notificationUrl（authStart 页面）
 * 才会真正触发发码 —— 那个页面是小米的 React SPA，发码动作在 JS 里。
 *
 * 服务端代为请求一次，用户无需手动跳转打开网页。
 */
export async function sendVerifyTicket(notificationUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!notificationUrl) return { ok: false, error: "缺少验证链接" };
  try {
    const res = await fetch(notificationUrl, {
      method: "GET",
      headers: {
        "User-Agent": MI_LOGIN_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      redirect: "follow",
    });
    // 页面本身只要成功返回即视为已触发发码（小米不返回结构化结果）
    if (!res.ok) return { ok: false, error: `验证码发送失败（HTTP ${res.status}）` };
    await res.text();
    logger.info("已请求小米验证页，触发发送验证码");
    return { ok: true };
  } catch (e) {
    logger.warn({ err: String(e) }, "请求小米验证页失败");
    return { ok: false, error: "验证码发送请求失败，请重试" };
  }
}

export async function verifyMiLogin(
  c: MiLoginCredentials,
  code: string,
  sign: string,
): Promise<MiLoginResult> {
  // 小米的短信验证码校验：带 _sign（会话上下文）+ code 重新提交登录接口。
  // 全程纯 API，不需要打开任何网页。
  const params = new URLSearchParams({
    _json: "true",
    sid: "micoapi",
    user: c.username,
    hash: crypto.createHash("md5").update(c.password).digest("hex").toUpperCase(),
    _sign: sign,
    code,
  });

  const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLoginAuth2?_json=true`, {
    method: "POST",
    headers: { "User-Agent": MI_LOGIN_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const j = parseMiLoginBody(await res.text());
  if (!j || typeof j !== "object") return { ok: false, error: "验证响应无法解析", raw: j };

  const userId = j.userId ? String(j.userId) : "";
  const ssecurity = String(j.ssecurity ?? "");
  const serviceToken = String(j.serviceToken ?? "");

  if (serviceToken && ssecurity && userId) {
    return { ok: true, mina: { userId, serviceToken, ssecurity } };
  }

  // 验证码错了 / 过期，把新 _sign 回传以便重试
  const newSign = String(j._sign ?? "");
  if (newSign) {
    return {
      ok: false,
      needVerify: { notificationUrl: String(j.notificationUrl ?? ""), _sign: newSign },
      error: describeLoginCode(Number(j.code ?? 0), String(j.desc ?? j.description ?? "")),
      raw: j,
    };
  }

  return {
    ok: false,
    error: describeLoginCode(Number(j.code ?? 0), String(j.desc ?? j.description ?? "")),
    raw: j,
  };
}


const MINA_BASE = 'https://api2.mina.mi.com';
const MINA_USER_AGENT = 'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103';

/** 生成 Mina 请求签名（nonce + 时间戳 + ssecurity 的 SHA1） */
function minaSignature(path: string, method: string, nonce: string, ssecurity: string): string {
  const now = Date.now();
  const data = `${path}&${method.toUpperCase()}&${nonce}&${now}&${ssecurity}`;
  const sha1 = crypto.createHash('sha1').update(data).digest('base64');
  return `${nonce} ${sha1}`;
}

/** Mina 请求封装 */
/**
 * ─────────────────────────────────────────────────────────────
 *  底层请求：改为走 SongLoft 的 miot 插件接口
 * ─────────────────────────────────────────────────────────────
 *
 * 背景：小米 /app 接口（api.io.mi.com）的签名协议复杂且易错，
 * 自研实现多次遇到 auth error。SongLoft 已完整实现该协议并稳定运行，
 * 故 ToneCore 复用其接口，避免重复踩坑。
 *
 * 认证：SongLoft 的 access token
 *   ① 优先从 sqlite 读现成 token（稳定，不依赖登录接口）
 *   ② 兜底调 /api/v1/auth/login 登录
 */

/** SongLoft 服务地址 */
const SL_BASE = process.env.SONGLOFT_BASE || 'http://192.168.31.2:58091';
/** SongLoft 数据目录（用于直读 token） */
const SL_DATA_DIR = process.env.SONGLOFT_DATA || '/songloft_data';

let cachedToken: string | null = null;
let cachedAt = 0;
const TOKEN_TTL = 6 * 3600 * 1000; // 6 小时

/** 从 SongLoft sqlite 读有效 token */
function readTokenFromDb(): string | null {
  try {
    const dbPath = `${SL_DATA_DIR}/songloft.db`;
    if (!fs.existsSync(dbPath)) return null;
    const out = execFileSync('sqlite3', [
      dbPath,
      "SELECT token_id FROM auth_tokens WHERE (revoked_at IS NULL OR revoked_at='') " +
      "AND expires_at > datetime('now') AND token_type='access' ORDER BY id DESC LIMIT 1;",
    ], { encoding: 'utf8', timeout: 5000 }).trim();
    return out || null;
  } catch (e) {
    logger.debug({ err: String(e) }, '读 SongLoft token 失败');
    return null;
  }
}

/** 兜底：登录 SongLoft 拿 token */
async function loginSongLoft(): Promise<string | null> {
  const user = process.env.SONGLOFT_USER || '';
  const pass = process.env.SONGLOFT_PASS || '';
  if (!user || !pass) return null;
  try {
    const res = await fetch(`${SL_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const j: any = await res.json();
    return j?.access_token || null;
  } catch (e) {
    logger.warn({ err: String(e) }, '登录 SongLoft 失败');
    return null;
  }
}

/** 获取有效 token（带缓存） */
async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() - cachedAt < TOKEN_TTL) return cachedToken;
  let t = readTokenFromDb();
  if (!t) t = await loginSongLoft();
  if (t) { cachedToken = t; cachedAt = Date.now(); }
  return t;
}

/** 调 SongLoft miot 接口 */
async function slRequest(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<any> {
  const token = await getToken();
  if (!token) return { error: '无法获取 SongLoft token' };

  const url = `${SL_BASE}/api/v1/jsplugin/miot${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    // 401 时清缓存重试一次
    if (res.status === 401) {
      cachedToken = null;
      const t2 = await getToken();
      if (t2) {
        const res2 = await fetch(url, {
          method: opts.method || 'GET',
          headers: { ...headers, Authorization: `Bearer ${t2}` },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        const t2text = await res2.text();
        try { return JSON.parse(t2text); } catch { return { raw: t2text }; }
      }
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (e) {
    logger.warn({ err: String(e), path }, 'SongLoft 请求失败');
    return { error: String(e) };
  }
}

/**
 * 兼容层：保留原签名，内部改走 SongLoft。
 * 旧的自研协议实现已停用（认证不可用）。
 */
export async function minaRequest(
  cfg: MinaConfig,
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<any> {
  // path 形如 /admin/v2/device_list、/remote/ubus —— 旧协议路径，此处不再使用
  logger.debug({ path }, 'minaRequest 已由 SongLoft 接口替代');
  return slRequest(path, opts);
}

/** 拉取音箱最近对话记录（语音点歌入口） */
export async function fetchConversations(
  cfg: MinaConfig,
  deviceId: string,
  limit = 5,
  timestamp = 0,
): Promise<any[]> {
  const r = await slRequest(
    `/conversation/messages?account_id=${encodeURIComponent(cfg.userId)}` +
    `&device_id=${encodeURIComponent(deviceId)}&limit=${limit}`,
  );
  const items = r?.data?.records || r?.data || r?.messages || [];
  return Array.isArray(items) ? items : [];
}

/** 让音箱播放指定 URL */
export async function playUrl(
  cfg: MinaConfig,
  deviceId: string,
  url: string,
): Promise<boolean> {
  const r = await slRequest('/mina/play-url', {
    method: 'POST',
    body: { account_id: cfg.userId, device_id: deviceId, url },
  });
  const ok = r?.success === true;
  logger.info({ deviceId, ok, err: r?.error }, '推送播放（SongLoft）');
  return ok;
}

/** 文本转语音并播报 */
export async function tts(cfg: MinaConfig, deviceId: string, text: string): Promise<boolean> {
  const r = await slRequest('/mina/tts', {
    method: 'POST',
    body: { account_id: cfg.userId, device_id: deviceId, text },
  });
  return r?.success === true;
}

/** 拉取账号下绑定的设备列表 */
export async function fetchDevices(cfg: MinaConfig): Promise<any[]> {
  const r = await slRequest('/mina/devices');
  const data = r?.data;
  if (!Array.isArray(data)) return [];
  // 摊平多账号结构，取目标账号的设备
  for (const acc of data) {
    if (String(acc.account_id) === String(cfg.userId)) {
      return (acc.devices || []).map((d: any) => ({
        deviceID: d.deviceID,
        name: d.name || d.alias,
        presence: d.presence,
        hardware: d.hardware,
        miotDID: d.miotDID,
      }));
    }
  }
  // 找不到指定账号时返回第一个账号的设备
  return (data[0]?.devices || []).map((d: any) => ({
    deviceID: d.deviceID,
    name: d.name || d.alias,
    presence: d.presence,
    hardware: d.hardware,
    miotDID: d.miotDID,
  }));
}
