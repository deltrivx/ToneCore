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
/**
 * 小米账号接口的 UA。
 *
 * 踩坑记录：UA 若不被识别为小米自家客户端，authStart 会直接返回 HTML 登录页
 * 而不是 JSON，导致拿不到 _sign（登录上下文），后续 serviceLoginAuth2 稳定报
 * code=10001「系统错误」。必须用带 MICO 标识的 App UA。
 */
const MI_LOGIN_UA =
  "MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103";

/** authStart 需要 JSON 响应，显式声明 Accept，避免被重定向到网页登录页 */
const MI_LOGIN_HEADERS: Record<string, string> = {
  "User-Agent": MI_LOGIN_UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://account.xiaomi.com/",
};

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
  // 关键：小米要求先走 authStart 拿登录上下文（context 即 _sign），
  // 缺少它会稳定返回 code=70016「登录验证失败」——与账号密码是否正确无关。
  let sign = "";
  try {
    const startRes = await fetch(
      `${MINA_LOGIN_BASE}/fe/service/identity/authStart?sid=micoapi&_locale=zh_CN&_json=true`,
      {
        method: "GET",
        headers: MI_LOGIN_HEADERS,
      },
    );
    const startBody = parseMiLoginBody(await startRes.text());
    sign = String(startBody?.context ?? startBody?._sign ?? "");
  } catch (e) {
    logger.debug({ err: String(e) }, "authStart 获取登录上下文失败，继续尝试无 sign 登录");
  }

  const params = new URLSearchParams({
    _json: "true",
    qs: "%40%3A%2F%2Faccount.xiaomi.com%2Fpass%2FserviceLoginAuth2",
    sid: "micoapi",
    serviceParam:
      "%7B%22checkSafePhone%22%3Afalse%2C%22checkSafeAddress%22%3Afalse%2C%22lsrp_score%22%3A0.0%7D",
    user: c.username,
    hash: c.password,
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

  // 需要短信 / 邮箱验证码：把你自己的 _sign 一并带出去，供第二步提交
  const needCode = j.notificationUrl || String(j._sign ?? "") || sign;
  if (needCode) {
    return {
      ok: false,
      needVerify: {
        notificationUrl: String(j.notificationUrl ?? ""),
        _sign: String(j._sign ?? sign),
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
  const table: Record<number, string> = {
    70016: "登录验证失败：未取得登录上下文（authStart）或账号密码不匹配",
    70002: "账号或密码错误",
    70003: "需要人机验证（验证码 / 滑块）",
    70004: "登录次数过多，已限流，请稍后再试",
    70005: "账号被锁定，请前往小米账号中心解锁",
    70011: "需要短信二次验证",
    70014: "该账号未绑定手机或邮箱",
    87001: "验证码错误或已过期",
    87002: "验证码错误或已过期",
  };
  const base = table[code] ?? desc ?? `登录失败（code=${code}）`;
  return code && !table[code] ? `${base}（code=${code}）` : base;
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
    callback: "https://api2.mina.mi.com/sts",
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

// ---------- 播放控制（player_control） ----------

/**
 * 音箱播放控制动作。
 *
 * 说明：小爱音箱的媒体控制统一走 mediaplayer 的 player_control 方法，
 * message 里的 action 取值见 DOWNLOAD/PLAY/PAUSE/STOP/NEXT/PREV。
 */
export type PlayerAction = 'play' | 'pause' | 'stop' | 'next' | 'prev';

/** 内部动作名 → ubus message 里的 action */
const PLAYER_ACTION_MAP: Record<PlayerAction, string> = {
  play: 'PLAY',
  pause: 'PAUSE',
  stop: 'STOP',
  next: 'NEXT',
  prev: 'PREV',
};

/**
 * 下发播放控制指令（上/下一首、暂停、停止）。
 *
 * 返回 true 表示音箱已接受指令 —— 注意这只代表「指令送达且被接收」，
 * 不代表音箱当前一定处于可执行状态（例如暂停在未播放时是空操作）。
 */
export async function playerControl(
  cfg: MinaConfig,
  deviceId: string,
  action: PlayerAction,
  mediaId = '',
): Promise<boolean> {
  const r = await minaRequest(cfg, '/remote/ubus', {
    method: 'POST',
    body: {
      deviceId,
      method: 'player_control',
      path: 'mediaplayer',
      message: JSON.stringify({ action: PLAYER_ACTION_MAP[action], mediaId }),
      requestId: `tc_pc_${Date.now()}`,
    },
  });
  const ok = r?.code === 0 || r?.message === 'success';
  if (!ok) {
    logger.debug(
      { deviceId, action, resp: JSON.stringify(r).slice(0, 200) },
      'playerControl 返回非成功',
    );
  }
  return ok;
}

/**
 * 设置音量（0~100）。
 *
 * 音箱音量走 mediaplayer 的 player_set_volume，message 里带 volume。
 * 超出范围直接截断，不抛错 —— 语音识别出的数字经常离谱（"音量一百"→100 没问题，
 * 但 "音量999" 也真会出现），截断比报错体验好。
 */
export async function setVolume(
  cfg: MinaConfig,
  deviceId: string,
  volume: number,
): Promise<boolean> {
  const v = Math.min(100, Math.max(0, Math.round(volume)));
  const r = await minaRequest(cfg, '/remote/ubus', {
    method: 'POST',
    body: {
      deviceId,
      method: 'player_set_volume',
      path: 'mediaplayer',
      message: JSON.stringify({ volume: v }),
      requestId: `tc_vol_${Date.now()}`,
    },
  });
  const ok = r?.code === 0 || r?.message === 'success';
  if (!ok) logger.debug({ deviceId, volume: v, resp: JSON.stringify(r).slice(0, 200) }, 'setVolume 返回非成功');
  return ok;
}

/** 查询当前音量（用于相对调节 / 状态展示） */
export async function getVolume(cfg: MinaConfig, deviceId: string): Promise<number | null> {
  const r = await minaRequest(cfg, '/remote/ubus', {
    method: 'POST',
    body: {
      deviceId,
      method: 'player_get_play_status',
      path: 'mediaplayer',
      message: JSON.stringify({}),
      requestId: `tc_volq_${Date.now()}`,
    },
  });
  // 响应形态在不同固件上不一致，尽量宽地找 volume 字段
  const raw = r?.data?.volume ?? r?.data?.info;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      if (typeof j?.volume === 'number') return j.volume;
    } catch { /* 非 JSON */ }
  }
  return null;
}

