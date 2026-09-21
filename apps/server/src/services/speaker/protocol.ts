import crypto from 'node:crypto';
import { logger } from '../../logger.js';

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
  const params = new URLSearchParams({
    _json: "true",
    qs: "%40%3A%2F%2Faccount.xiaomi.com%2Fpass%2FserviceLoginAuth2",
    sid: "micoapi",
    serviceParam: "%7B%22checkSafePhone%22%3Afalse%2C%22checkSafeAddress%22%3Afalse%2C%22lsrp_score%22%3A0.0%7D",
    user: c.username,
    hash: c.password,
  });

  const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLoginAuth2?_json=true`, {
    method: "POST",
    headers: {
      "User-Agent": MI_LOGIN_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: "sdkVersion=3.9; deviceId=TC",
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

  const code = Number(j.code ?? 0);
  if (code === 70016 || j.notificationUrl) {
    return {
      ok: false,
      needVerify: { notificationUrl: String(j.notificationUrl ?? ""), _sign: String(j._sign ?? "") },
      error: "需要短信/邮箱验证码",
      raw: j,
    };
  }

  return { ok: false, error: String(j.desc ?? j.error ?? j.message ?? `登录失败（code=${code}）`), raw: j };
}

/** 步骤二：提交短信 / 邮箱验证码完成登录 */
export async function verifyMiLogin(
  c: MiLoginCredentials,
  code: string,
  sign: string,
): Promise<MiLoginResult> {
  const params = new URLSearchParams({
    _json: "true",
    user: c.username,
    code,
    _sign: sign,
    callback: "https://account.xiaomi.com/pass/loginAuth2?sid=micoapi",
    sid: "micoapi",
  });

  const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLoginAuth2`, {
    method: "POST",
    headers: { "User-Agent": MI_LOGIN_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const j = parseMiLoginBody(await res.text());
  const userId = j?.userId ? String(j.userId) : "";
  const ssecurity = String(j?.ssecurity ?? "");
  const serviceToken = String(j?.serviceToken ?? "");
  if (serviceToken && ssecurity && userId) {
    return { ok: true, mina: { userId, serviceToken, ssecurity } };
  }
  return { ok: false, error: String(j?.desc ?? j?.error ?? "验证码校验失败"), raw: j };
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
export async function minaRequest(
  cfg: MinaConfig,
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<any> {
  const method = opts.method || 'GET';
  const nonce = crypto.randomBytes(8).toString('base64');
  const url = new URL(MINA_BASE + path);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    'User-Agent': MINA_USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: `userId=${cfg.userId}; serviceToken=${cfg.serviceToken}`,
    'x-xiaomi-protocal-flag-cli': 'PROTOCAL_CONTENT_JSON',
  };

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body ? new URLSearchParams(opts.body as any).toString() : undefined,
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

/** 拉取音箱最近对话记录（语音点歌的关键入口） */
export async function fetchConversations(
  cfg: MinaConfig,
  deviceId: string,
  limit = 5,
  timestamp = 0,
): Promise<any[]> {
  const r = await minaRequest(cfg, '/admin/v2/conversation', {
    query: {
      deviceId,
      limit: String(limit),
      timestamp: String(timestamp),
      userId: cfg.userId,
    },
  });
  const items = r?.data?.records || r?.data || [];
  return Array.isArray(items) ? items : [];
}

/** 让音箱播放指定 URL（TTS + 指令） */
export async function playUrl(
  cfg: MinaConfig,
  deviceId: string,
  url: string,
): Promise<boolean> {
  // 原理：给音箱下发"播放音乐"指令，携带 audio url
  const body = {
    deviceId,
    url: url,
    type: 1,
    timestamp: Date.now(),
  };
  const r = await minaRequest(cfg, '/remote/ubus', {
    method: 'POST',
    body: {
      deviceId,
      method: 'player_play_url',
      path: 'mediaplayer',
      message: JSON.stringify({ url, type: 1 }),
      requestId: `tc_${Date.now()}`,
    },
  });
  const ok = r?.code === 0 || r?.message === 'success';
  if (!ok) logger.debug({ deviceId, resp: JSON.stringify(r).slice(0, 200) }, 'playUrl 返回非成功');
  return ok;
}

/** 文本转语音并播报（用于点歌失败的提示） */
export async function tts(cfg: MinaConfig, deviceId: string, text: string): Promise<boolean> {
  const r = await minaRequest(cfg, '/remote/ubus', {
    method: 'POST',
    body: {
      deviceId,
      method: 'text_to_speech',
      path: 'mibrain',
      message: JSON.stringify({ text }),
      requestId: `tc_tts_${Date.now()}`,
    },
  });
  return r?.code === 0;
}

/** 拉取账号下绑定的设备列表 */
export async function fetchDevices(cfg: MinaConfig): Promise<any[]> {
  const r = await minaRequest(cfg, '/admin/v2/device_list', {
    query: { master: '0', userId: cfg.userId },
  });
  return r?.data || [];
}
