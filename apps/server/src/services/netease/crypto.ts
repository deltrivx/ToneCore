import crypto from 'node:crypto';
import zlib from 'node:zlib';

/**
 * 网易云 eapi / weapi 加密（对标 NEMbox/encrypt.py）。
 *
 * 为什么必须自己实现：网易的 weapi 接口（登录、歌单、每日推荐、高音质取链）
 * 全部要求 body 为 `params` + `encSecKey` 这两个加密字段，
 * 明文直接请求会返回空或 302 到 404。
 *
 * 算法（三层）：
 *   1. 随机 16 字节密钥 secret
 *   2. params = base64(AES-CBC(base64(AES-CBC(json, NONCE)), secret))
 *      —— 注意是**双重** AES：第一层用固定 NONCE，第二层用随机 secret；
 *         两层的 IV 都是固定的 "0102030405060708"。
 *   3. encSecKey = RSA(secret.reverse()) —— 用 BigInt 做的模幂，
 *      因为 Node 的 publicEncrypt 需要 DER 公钥，而这里只有裸的 modulus+exponent。
 *
 * ⚠️ 参考来源：飞牛音乐扩展所用的 NEMbox（NetEase-MusicBox）encrypt.py。
 *   只参考**算法**，不读取、不复用其任何登录态（cookie）。
 */

/** 第一层固定密钥（网易硬编码，公开常量） */
const NONCE = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
/** AES-CBC 固定 IV */
const IV = Buffer.from('0102030405060708', 'utf8');

const MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7' +
  'b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280' +
  '104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932' +
  '575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b' +
  '3ece0462db0a22b8e7';
const PUBKEY = '010001';

/** AES-128-CBC 加密后 base64（PKCS#7 由 Node 默认补齐） */
function aesEncrypt(buf: Buffer, key: Buffer): string {
  const c = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([c.update(buf), c.final()]).toString('base64');
}

/** 大数模幂：BigInt 直接 ** 会瞬爆，必须逐位平方 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/**
 * RSA 加密（NEMbox 同款：先反转字节序，再做模幂，最后补零到 256 位十六进制）。
 */
function rsaEncrypt(secret: Buffer): string {
  const reversed = Buffer.from([...secret].reverse());
  const n = BigInt('0x' + MODULUS);
  const e = BigInt('0x' + PUBKEY);
  const m = BigInt('0x' + (reversed.toString('hex') || '0'));
  return modPow(m, e, n).toString(16).padStart(256, '0');
}

/**
 * 把一个 JS 对象加密成 weapi 的 form body 参数。
 *
 * ⚠️ secret 必须是 **16 个 ASCII 十六进制字符**（不是 16 个原始随机字节）。
 *
 * 这是实测踩过的坑（2026-10-03）：NEMbox 的 create_key() 是
 * `binascii.hexlify(os.urandom(16))[:16]` —— 先转成十六进制字符串再截 16 位，
 * 得到的是 16 个 **ASCII 字符**（如 "a3f2..."）。若误写成 16 个原始随机字节，
 * 密钥位数虽然也是 16，但字节内容不同，服务端解不出 secret，
 * 于是**静默返回 HTTP 200 空响应体** —— 极难排查（状态码看着完全正常）。
 *
 * @param obj 明文请求参数（会 JSON 序列化）
 * @returns { params, encSecKey } —— 直接作为 x-www-form-urlencoded 提交
 */
export function weapi(obj: Record<string, unknown>): { params: string; encSecKey: string } {
  // 与 NEMbox create_key(size) 保持一致：hexlify → 截 16 个 ASCII 字符
  const secret = Buffer.from(crypto.randomBytes(16).toString('hex').slice(0, 16), 'utf8');
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const first = Buffer.from(aesEncrypt(json, NONCE), 'utf8');
  const params = aesEncrypt(first, secret);
  return { params, encSecKey: rsaEncrypt(secret) };
}

/** 把 { params, encSecKey } 转成 form body */
export function toFormBody(p: { params: string; encSecKey: string }): string {
  return `params=${encodeURIComponent(p.params)}&encSecKey=${encodeURIComponent(p.encSecKey)}`;
}

/** ---------- eapi（interface.music.163.com）---------- */

/** eapi 固定密钥（与 weapi 不同） */
const EAPI_KEY = Buffer.from('e82ckenh8dichen8', 'utf8');

function pkcs7Pad(buf: Buffer): Buffer {
  const pad = 16 - (buf.length % 16);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 16) return buf;
  return buf.subarray(0, buf.length - pad);
}

/**
 * eapi 请求体加密。
 *
 * 格式：`{uri}-36cd479b6b5-{json}-36cd479b6b5-{md5(nobody{uri}use{json}md5forencrypt)}`
 * 用 AES-128-ECB 加密后输出**大写 hex**。
 */
export function eapiEncrypt(uri: string, payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload);
  const digest = crypto.createHash('md5')
    .update(`nobody${uri}use${text}md5forencrypt`)
    .digest('hex');
  const plain = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const c = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(pkcs7Pad(Buffer.from(plain, 'utf8'))), c.final()])
    .toString('hex').toUpperCase();
}

/**
 * eapi 响应解密：AES-128-ECB →（可能是 gzip）→ JSON。
 *
 * 实测：取链与歌单详情的响应都是密文，必须解密才能用；
 * 且部分响应带 gzip 压缩（magic 1f 8b）。
 */
export function eapiDecrypt(data: Buffer | string): any {
  const buf = typeof data === 'string'
    ? (/^[0-9A-Fa-f]+$/.test(data.trim()) ? Buffer.from(data.trim(), 'hex') : Buffer.from(data, 'latin1'))
    : data;
  const d = crypto.createDecipheriv('aes-128-ecb', EAPI_KEY, null);
  d.setAutoPadding(false);
  const raw = pkcs7Unpad(Buffer.concat([d.update(buf), d.final()]));
  // gzip magic (1f 8b)：部分 eapi 响应带压缩，需先解压再解析
  const plain: Buffer = (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)
    ? zlib.gunzipSync(raw)
    : raw;
  return JSON.parse(plain.toString('utf8'));
}

/**
 * 歌曲 id 加密（NEMbox 的 encrypted_id），用于拼接音频直链的备用形态。
 * 当前取链走 player/url 接口不需要它，保留以备后续。
 */
export function encryptedId(id: string): string {
  const magic = Buffer.from('3go8&$8*3*3h0k(2)2', 'utf8');
  const sid = Buffer.from(id, 'utf8');
  const out = Buffer.alloc(sid.length);
  for (let i = 0; i < sid.length; i++) out[i] = sid[i] ^ magic[i % magic.length];
  return crypto.createHash('md5').update(out).digest('base64')
    .replace(/\//g, '_').replace(/\+/g, '-');
}
