import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';

/**
 * 音频标签写入层。
 *
 * 设计取舍：不引入额外原生依赖。
 *   - MP3 用 node-id3（已在依赖里，纯 JS，读写都稳）
 *   - FLAC 的 Vorbis Comment 结构简单，自己按块写（见下）
 *
 * 为什么 FLAC 不用现成库：可选的几个库要么年久失修，要么引入新的原生编译
 * （镜像里得再加一套构建工具链）。Vorbis Comment 的格式固定、字段都是
 * 长度前缀的 UTF-8，自己写反而更可控、更好排查。
 */

export interface TagInput {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  year?: number;
  cover?: { data: Buffer; mime: string };
  lyrics?: string;
}

export interface WriteResult {
  ok: boolean;
  /** 实际写入的字段名 */
  written: string[];
  error?: string;
}

const FLAC_MARKER = Buffer.from('fLaC', 'ascii');
const VORBIS_BLOCK = 4;      // Vorbis Comment
const PICTURE_BLOCK = 6;     // Picture

/** Vorbis Comment 的字段名映射（FLAC 里键名大写是惯例） */
function vorbisKey(k: keyof TagInput): string | null {
  const map: Record<string, string> = {
    title: 'TITLE', artist: 'ARTIST', album: 'ALBUM',
    albumArtist: 'ALBUMARTIST', track: 'TRACKNUMBER',
    year: 'DATE', lyrics: 'LYRICS',
  };
  return map[k as string] ?? null;
}

/** 构造一条 Vorbis Comment 记录：长度(4, LE) + "KEY=value"(UTF-8) */
function vorbisEntry(key: string, value: string): Buffer {
  const body = Buffer.from(`${key}=${value}`, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

/**
 * 写入 FLAC 标签。
 *
 * 做法：解析 block 链，丢弃旧的 Vorbis Comment / Picture 块，
 * 在 STREAMINFO 之后插入新块，其余块原样保留。
 * 最后一块的「is-last」标志位需要重算 —— 这是最容易写错的地方。
 */
async function writeFlac(absPath: string, tag: TagInput): Promise<WriteResult> {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 4 || !buf.subarray(0, 4).equals(FLAC_MARKER)) {
    return { ok: false, written: [], error: '不是有效的 FLAC 文件' };
  }

  // ---- 解析现有 block 链 ----
  const blocks: { type: number; data: Buffer }[] = [];
  let off = 4;
  let last = false;
  while (!last && off + 4 <= buf.length) {
    const header = buf[off];
    last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    const start = off + 4;
    const end = start + size;
    if (end > buf.length) break;
    blocks.push({ type, data: buf.subarray(start, end) });
    off = end;
  }
  const audio = buf.subarray(off);   // 帧数据，必须原样保留

  // ---- 丢弃旧的 Vorbis Comment / Picture ----
  const kept = blocks.filter((b) => b.type !== VORBIS_BLOCK && b.type !== PICTURE_BLOCK);

  // ---- 构造新的 Vorbis Comment ----
  // 结构：vendor 长度(4,LE) + vendor 字符串 + 字段数(4,LE) + 各字段记录
  const entries: Buffer[] = [];
  entries.push(vorbisEntry('VENDOR', 'ToneCore'));
  for (const [k, v] of Object.entries(tag)) {
    if (k === 'cover' || v === undefined || v === null || v === '') continue;
    const key = vorbisKey(k as keyof TagInput);
    if (!key) continue;
    entries.push(vorbisEntry(key, String(v)));
  }
  const vendorBody = Buffer.from('ToneCore', 'utf8');
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendorBody.length, 0);
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(entries.length - 1, 0);   // 减掉 vendor 那一条
  const finalComment = Buffer.concat([vendorLen, vendorBody, countBuf, ...entries.slice(1)]);

  kept.push({ type: VORBIS_BLOCK, data: finalComment });

  // ---- 封面：FLAC 的 Picture 块单独一层 ----
  if (tag.cover && tag.cover.data.length) {
    const pic = buildFlacPicture(tag.cover.data, tag.cover.mime);
    // 官方建议 Picture 紧跟 Vorbis Comment 之后
    kept.push({ type: PICTURE_BLOCK, data: pic });
  }

  // ---- 序列化 ----
  const chunks: Buffer[] = [FLAC_MARKER];
  kept.forEach((b, i) => {
    const isLast = i === kept.length - 1;
    const header = Buffer.alloc(4);
    header[0] = (isLast ? 0x80 : 0) | b.type;
    header[1] = (b.data.length >> 16) & 0xff;
    header[2] = (b.data.length >> 8) & 0xff;
    header[3] = b.data.length & 0xff;
    chunks.push(header, b.data);
  });
  chunks.push(audio);

  const out = Buffer.concat(chunks);
  // 先写临时文件再原子改名，避免写坏原文件
  const tmp = absPath + '.tagtmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, absPath);

  const written = Object.keys(tag).filter((k) => tag[k as keyof TagInput] !== undefined && k !== 'cover');
  if (tag.cover) written.push('cover');
  return { ok: true, written };
}

/** 构造 FLAC Picture 块（结构固定：类型 + MIME + 描述 + 宽高深 + 数据） */
function buildFlacPicture(data: Buffer, mime: string): Buffer {
  const mimeBuf = Buffer.from(mime || 'image/jpeg', 'ascii');
  const descBuf = Buffer.alloc(0);

  const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };

  return Buffer.concat([
    be32(3),                 // picture type 3 = front cover
    be32(mimeBuf.length), mimeBuf,
    be32(descBuf.length), descBuf,
    be32(0), be32(0),        // width / height（未知填 0，播放器会自行解码）
    be32(24), be32(0),       // color depth / color count
    be32(data.length), data,
  ]);
}

/** 写入 MP3（ID3v2）标签 */
async function writeMp3(absPath: string, tag: TagInput): Promise<WriteResult> {
  const NodeID3 = (await import('node-id3')).default;
  const tags: Record<string, any> = {};
  if (tag.title) tags.title = tag.title;
  if (tag.artist) tags.artist = tag.artist;
  if (tag.album) tags.album = tag.album;
  if (tag.albumArtist) tags.performerInfo = tag.albumArtist;
  if (tag.track) tags.trackNumber = String(tag.track);
  if (tag.year) tags.year = String(tag.year);
  if (tag.lyrics) tags.unsynchronisedLyrics = { language: 'chi', text: tag.lyrics };
  if (tag.cover) {
    tags.image = {
      mime: tag.cover.mime || 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'cover',
      imageBuffer: tag.cover.data,
    };
  }

  // node-id3 的返回类型是 `true | Error`（成功为 true，失败为 Error）
  const ok = NodeID3.write(tags, absPath);
  if (ok !== true) {
    const msg = ok instanceof Error ? ok.message : String(ok);
    return { ok: false, written: [], error: msg.slice(0, 200) };
  }
  const written = Object.keys(tag).filter((k) => tag[k as keyof TagInput] !== undefined && k !== 'cover');
  if (tag.cover) written.push('cover');
  return { ok: true, written };
}

/**
 * 给音频文件写入标签。
 *
 * 目前支持 FLAC 与 MP3 —— 这两者覆盖了点歌落库的绝大多数场景。
 * 其余格式（m4a/wav/ogg）暂不写入，返回 ok:false 并说明原因，
 * 不静默假装成功。
 */
export async function writeTags(absPath: string, tag: TagInput): Promise<WriteResult> {
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (ext === '.flac') return await writeFlac(absPath, tag);
    if (ext === '.mp3') return await writeMp3(absPath, tag);
    return { ok: false, written: [], error: `暂不支持写入 ${ext} 的标签` };
  } catch (e) {
    logger.warn({ file: absPath, err: String(e).slice(0, 200) }, '写入标签失败');
    return { ok: false, written: [], error: String(e).slice(0, 200) };
  }
}
