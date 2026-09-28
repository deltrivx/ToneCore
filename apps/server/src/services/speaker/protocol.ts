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
  /** 账号密码（明文；内部会转成 MD5 大写后再提交） */
  password: string;
}

/** 密码 → 小米登录所需的 hash：MD5(明文) 大写 */
export function hashPassword(plain: string): string {
  const p = String(plain ?? "");
  // 已经是 32 位十六进制的按已哈希处理，避免重复加密
  if (/^[0-9a-fA-F]{32}$/.test(p)) return p.toUpperCase();
  return crypto.createHash("md5").update(p, "utf8").digest("hex").toUpperCase();
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
  needVerify?: {
    notificationUrl?: string;
    _sign?: string;
    /** 第一步拿到的 qs / serviceParam / callback —— 校验步骤必须原样带回去 */
    qs?: string;
    serviceParam?: string;
    callback?: string;
  };
  /** 登录成功后可直接构造 MinaConfig */
  mina?: MinaConfig;
  /** 失败原因（用于前端展示） */
  error?: string;
  raw?: unknown;
}

/** 登录上下文（第一步 /pass/serviceLogin 的回传值） */
interface LoginContext {
  sign: string;
  qs: string;
  serviceParam: string;
  callback: string;
  /** 已登录状态下才会返回 */
  userId: string;
  ssecurity: string;
}

/** 从响应里取指定 cookie（Node fetch 不自动管理 cookie，需手动取） */
function cookieFrom(res: Response, name: string): string {
  const h = res.headers as any;
  const raws: string[] = typeof h.getSetCookie === "function"
    ? h.getSetCookie()
    : (res.headers.get("set-cookie") ? [String(res.headers.get("set-cookie"))] : []);
  for (const c of raws) {
    const m = /^([^=]+)=([^;]*)/.exec(c);
    if (m && m[1].trim() === name) return decodeURIComponent(m[2].trim());
  }
  return "";
}

/**
 * 第一步：取登录上下文。
 *
 * ⚠️ 端点必须是 /pass/serviceLogin，不是 /fe/service/identity/authStart。
 * 实测（2026-09-28）：authStart 已改为直接返回 React 登录页 HTML（约 22KB），
 * 不再是 JSON，解析不出 _sign ⇒ 第二步必然 code=10001。
 * _json=true 是拿到 JSON 的必要条件（不带则同样返回 HTML）。
 *
 * 已登录状态下这一步会额外返回 userId / ssecurity（code=0）。
 * 验证码校验完成后要靠它补齐 ssecurity —— 对齐 HA 复用 _login_step1 的做法：
 * ssecurity 只在 step1 返回，location 的响应里没有。
 */
async function fetchLoginContext(cookie = ""): Promise<LoginContext> {
  const fallback: LoginContext = {
    sign: "",
    qs: "%3Fsid%3Dmicoapi%26_json%3Dtrue",
    serviceParam:
      "%7B%22checkSafePhone%22%3Afalse%2C%22checkSafeAddress%22%3Afalse%2C%22lsrp_score%22%3A0.0%7D",
    callback: "https://api2.mina.mi.com/sts",
    userId: "",
    ssecurity: "",
  };
  try {
    const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLogin?sid=micoapi&_json=true`, {
      method: "GET",
      headers: cookie ? { ...MI_LOGIN_HEADERS, Cookie: cookie } : MI_LOGIN_HEADERS,
    });
    const b = parseMiLoginBody(await res.text());
    return {
      sign: String(b?._sign ?? b?.context ?? ""),
      qs: String(b?.qs ?? fallback.qs),
      serviceParam: String(b?.serviceParam ?? fallback.serviceParam),
      callback: String(b?.callback ?? fallback.callback),
      userId: String(b?.userId ?? ""),
      ssecurity: String(b?.ssecurity ?? ""),
    };
  } catch (e) {
    logger.debug({ err: String(e) }, "获取登录上下文失败");
    return fallback;
  }
}

/**
 * 步骤一：账号密码登录小米账号。
 * 成功直接拿到 serviceToken/ssecurity → 可直接用；需要验证码则返回 notificationUrl。
 */
export async function loginMiAccount(c: MiLoginCredentials): Promise<MiLoginResult> {
  const ctx = await fetchLoginContext();
  if (!ctx.sign) {
    logger.warn("未能取得登录上下文 _sign，登录很可能返回 code=10001");
  }

  // ⚠️ hash 必须是「密码的 MD5 大写」，不是明文密码。
  // 小米 serviceLoginAuth2 的契约如此；传明文会稳定返回 code=70016
  // 「登录验证失败」，且与账号密码是否正确无关，极容易被误判成风控。
  // 已在 hashPassword() 里统一处理，调用方传明文即可。
  const params = new URLSearchParams({
    _json: "true",
    qs: ctx.qs,
    sid: "micoapi",
    serviceParam: ctx.serviceParam,
    user: c.username,
    hash: hashPassword(c.password),
    callback: ctx.callback,
  });
  if (ctx.sign) params.set("_sign", ctx.sign);

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

  // 直接成功：location 指向 STS，serviceToken 由 Set-Cookie 下发（见 finishLogin）
  if (j.location) return await finishLogin(j, ctx);

  const userId = j.userId ? String(j.userId) : "";
  const ssecurity = String(j.ssecurity ?? "");
  const serviceToken = String(j.serviceToken ?? "");
  if (serviceToken && ssecurity && userId) {
    return { ok: true, mina: { userId, serviceToken, ssecurity } };
  }

  // 需要短信 / 邮箱验证码：把完整登录上下文带出去，供校验步骤原样复用
  const code0 = String(j.code ?? "");
  const needsVerify = !!j.notificationUrl || code0 === "81003";
  if (needsVerify) {
    return {
      ok: false,
      needVerify: {
        notificationUrl: String(j.notificationUrl ?? ""),
        _sign: String(j._sign ?? ctx.sign),
        qs: ctx.qs,
        serviceParam: ctx.serviceParam,
        callback: ctx.callback,
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

/** 校验步骤要复用的登录上下文 */
export interface VerifyContext {
  sign: string;
  qs: string;
  serviceParam: string;
  callback: string;
}

/**
 * 第三步：跟随 location 换取 serviceToken（对齐 Home Assistant 的 `_login_step3`）。
 *
 * ⚠️ micoapi 的 location 指向 api2.mina.mi.com/sts，serviceToken 是通过
 * **Set-Cookie** 下发的，**不在响应体里**。旧实现只在 JSON 里找 serviceToken，
 * 找不到就当成失败 —— 这是「验证码明明对却报登录验证失败」的一个成因。
 *
 * 另外 micoapi 需要在 location 后追加 clientSign，否则 STS 返回 401。
 */
async function finishLogin(j: any, ctx: VerifyContext, cookie = ""): Promise<MiLoginResult> {
  const userId = String(j?.userId ?? "");
  const ssecurity = String(j?.ssecurity ?? "");
  const location = String(j?.location ?? "");
  const nonce = String(j?.nonce ?? "");

  if (!location || !userId || !ssecurity) {
    return {
      ok: false,
      error: String(j?.desc ?? j?.error ?? "登录未完成（缺少 location 或凭据字段）"),
      raw: j,
    };
  }

  let url = location;
  if (nonce) {
    // clientSign = base64(sha1("nonce=<nonce>&<ssecurity>"))
    const cs = crypto.createHash("sha1").update(`nonce=${nonce}&${ssecurity}`).digest("base64");
    url += `&clientSign=${encodeURIComponent(cs)}`;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      // 带上校验步骤积累的 cookie：STS 依赖 identity session 才肯下发 serviceToken
      headers: cookie ? { "User-Agent": MI_LOGIN_UA, Cookie: cookie } : { "User-Agent": MI_LOGIN_UA },
    });
    const svc = cookieFrom(res, "serviceToken");
    const uid = cookieFrom(res, "userId") || userId;
    if (svc) return { ok: true, mina: { userId: uid, serviceToken: svc, ssecurity } };
    // 兜底：个别链路会把它放在响应体里
    const bodyToken = String(j?.serviceToken ?? "");
    if (bodyToken) return { ok: true, mina: { userId, serviceToken: bodyToken, ssecurity } };
    return { ok: false, error: "已通过登录但未取到 serviceToken", raw: { status: res.status, url } };
  } catch (e) {
    return { ok: false, error: "换取 serviceToken 失败：" + String(e).slice(0, 120), raw: j };
  }
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

/** 默认 serviceParam（第一步未回传时的兜底） */
const DEFAULT_SERVICE_PARAM =
  "%7B%22checkSafePhone%22%3Afalse%2C%22checkSafeAddress%22%3Afalse%2C%22lsrp_score%22%3A0.0%7D";

/** 把响应里的 Set-Cookie 拼成后续请求的 Cookie 头 */
function cookieHeaderFrom(res: Response): string {
  const h = res.headers as any;
  const raws: string[] = typeof h.getSetCookie === "function"
    ? h.getSetCookie()
    : (res.headers.get("set-cookie") ? [String(res.headers.get("set-cookie"))] : []);
  const parts: string[] = [];
  for (const c of raws) {
    const m = /^([^=]+)=([^;]*)/.exec(c);
    if (m) parts.push(`${m[1].trim()}=${m[2].trim()}`);
  }
  return parts.join("; ");
}

/**
 * 步骤二：提交短信 / 邮箱验证码完成登录。
 *
 * 对齐 Home Assistant（xiaomi_miot/core/xiaomi_cloud.py 的 `_login_step2`）后修正的三处：
 *
 * 1. **必须带 hash（密码 MD5 大写）**。HA 的 step2 无条件带上它；我们原先只在
 *    密码登录时传、验证码校验时不传，小米于是稳定返回 70016「登录验证失败」，
 *    **与验证码是否正确完全无关** —— 这正是「验证码没错却报登录验证失败」的成因。
 * 2. **必须带第一步回传的 qs / serviceParam / callback / _sign**，不能本地硬编码。
 * 3. **成功时响应体里没有 serviceToken**。返回的是 location（指向 api2.mina.mi.com/sts），
 *    serviceToken 由该请求的 **Set-Cookie** 下发；且 ssecurity 只在第一步返回，
 *    校验响应里没有，需重新取一次补齐（HA 源码对此有明确注释）。
 *    旧实现只在 JSON 里找 serviceToken，找不到就判失败。
 */
export async function verifyMiLogin(
  c: MiLoginCredentials,
  code: string,
  sign: string,
  ctx?: Partial<VerifyContext>,
): Promise<MiLoginResult> {
  const params = new URLSearchParams({
    _json: "true",
    user: c.username,
    hash: hashPassword(c.password),
    code,
    _sign: sign,
    callback: ctx?.callback || "https://api2.mina.mi.com/sts",
    qs: ctx?.qs || "%3Fsid%3Dmicoapi%26_json%3Dtrue",
    sid: "micoapi",
    serviceParam: ctx?.serviceParam || DEFAULT_SERVICE_PARAM,
  });

  const res = await fetch(`${MINA_LOGIN_BASE}/pass/serviceLoginAuth2?_json=true`, {
    method: "POST",
    headers: { "User-Agent": MI_LOGIN_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const j = parseMiLoginBody(await res.text());
  if (!j || typeof j !== "object") return { ok: false, error: "校验响应无法解析", raw: j };

  const jar = cookieHeaderFrom(res);

  // 校验通过：location → 换 serviceToken（Set-Cookie）
  if (j.location) {
    let ssecurity = String(j.ssecurity ?? "");
    let userId = String(j.userId ?? "");
    // ssecurity 只在第一步返回，校验响应里通常没有 → 带上 cookie 再取一次
    if (!ssecurity || !userId) {
      const fresh = await fetchLoginContext(jar);
      ssecurity = ssecurity || fresh.ssecurity;
      userId = userId || fresh.userId;
    }
    const full: VerifyContext = {
      sign,
      qs: ctx?.qs || "%3Fsid%3Dmicoapi%26_json%3Dtrue",
      serviceParam: ctx?.serviceParam || DEFAULT_SERVICE_PARAM,
      callback: ctx?.callback || "https://api2.mina.mi.com/sts",
    };
    return finishLogin({ ...j, ssecurity, userId }, full, jar);
  }

  // 响应体里直接给了完整凭据（少数链路）
  const userId = String(j.userId ?? "");
  const ssecurity = String(j.ssecurity ?? "");
  const serviceToken = String(j.serviceToken ?? "");
  if (serviceToken && ssecurity && userId) {
    return { ok: true, mina: { userId, serviceToken, ssecurity } };
  }

  const code0 = Number(j.code ?? 0);
  if (code0 === 81003 || j.notificationUrl) {
    return {
      ok: false,
      needVerify: {
        notificationUrl: String(j.notificationUrl ?? ""),
        _sign: String(j._sign ?? sign),
        qs: ctx?.qs,
        serviceParam: ctx?.serviceParam,
        callback: ctx?.callback,
      },
      error: "仍需验证，请重新获取验证码",
      raw: j,
    };
  }

  return {
    ok: false,
    error: describeLoginCode(code0, String(j.desc ?? j.description ?? "验证码校验失败")),
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
  if (!res.ok) {
    // 401 是凭据失效的特征码。这里必须抛出带标记的异常：
    // 上层若把 401 当成「没设备」静默吞掉，界面会显示 devices:0，
    // 用户看到的是「没连上设备」，真实原因却是登录态过期 —— 极难排查。
    throw new MinaAuthError(res.status, text.slice(0, 200));
  }
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

/** Mina 接口鉴权失败（凭据失效 / 过期） */
export class MinaAuthError extends Error {
  constructor(public status: number, public snippet: string) {
    super(`小米接口鉴权失败 (HTTP ${status})：登录态可能已过期，请重新登录`);
    this.name = 'MinaAuthError';
  }
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

/** 凭据是否仍然有效（用一次轻量请求探活，不依赖本地过期时间） */
export async function probeCredential(cfg: MinaConfig): Promise<boolean> {
  try {
    await minaRequest(cfg, '/admin/v2/device_list', {
      query: { master: '0', userId: cfg.userId },
    });
    return true;
  } catch (e) {
    if (e instanceof MinaAuthError) return false;
    // 网络抖动等不算凭据失效，探活失败时保持原判断
    throw e;
  }
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

