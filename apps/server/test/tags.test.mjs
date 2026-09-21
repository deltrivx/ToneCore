/**
 * FLAC 标签写入的结构校验。
 *
 * 目的：tags.ts 里的 FLAC 写入是手写的二进制逻辑，类型检查过了
 * 不代表字节结构是对的。这里构造最小 FLAC，写入标签后用
 * music-metadata 反向解析，确认字段能读回来、音频帧未损坏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { writeTags } from '../dist/services/scraper/tags.js';

const dir = 'C:/Users/User/AppData/Local/Temp/tc_tagtest';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

/** 构造最小合法 FLAC 头：fLaC + STREAMINFO(is-last) + 伪帧数据 */
function makeMinimalFlac() {
  const streaminfo = Buffer.alloc(34);
  // 填点像样的 STREAMINFO：min/max blocksize
  streaminfo.writeUInt16BE(4096, 0);
  streaminfo.writeUInt16BE(4096, 2);
  const hdr = Buffer.alloc(4);
  hdr[0] = 0x80 | 0;                       // is-last=1, type=0 STREAMINFO
  hdr.writeUIntBE(streaminfo.length, 1, 3);
  const frames = Buffer.from('FAKEFRAMEDATA'.repeat(40));
  return Buffer.concat([Buffer.from('fLaC'), hdr, streaminfo, frames]);
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---------- 用例 1：写入标签后可被正确解析 ----------
console.log('用例 1：写入标签 → 反向解析');
{
  const f = path.join(dir, 'plain.flac');
  fs.writeFileSync(f, makeMinimalFlac());

  const res = await writeTags(f, {
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    albumArtist: '周杰伦',
    track: 3,
    year: 2003,
    lyrics: '[00:01.00]故事的小黄花',
  });
  check('写入返回 ok', res.ok, JSON.stringify(res));
  check('报告了写入字段', res.written.length >= 5, JSON.stringify(res.written));

  const md = await parseFile(f, { duration: false });
  check('title 正确', md.common.title === '晴天', `得到 ${md.common.title}`);
  check('artist 正确', md.common.artist === '周杰伦', `得到 ${md.common.artist}`);
  check('album 正确', md.common.album === '叶惠美', `得到 ${md.common.album}`);
  check('track 正确', md.common.track?.no === 3, `得到 ${md.common.track?.no}`);
  check('year 正确', md.common.year === 2003, `得到 ${md.common.year}`);
  // music-metadata 会把纯 LRC 文本解析成字符串数组（不是对象数组），
  // 两种形态都要能认 —— 不同格式/版本的解析结果不一致。
  const lyrText = (md.common.lyrics ?? [])
    .map((l) => (typeof l === 'string' ? l : (l?.text ?? l?.description ?? '')))
    .join('\n');
  check('歌词保留', lyrText.includes('故事的小黄花'), `得到 ${JSON.stringify(md.common.lyrics)}`);
  check('音频帧未被破坏', fs.readFileSync(f).includes(Buffer.from('FAKEFRAMEDATA')));

  // 块链必须恰好一个 is-last
  const buf = fs.readFileSync(f);
  let off = 4, last = false, blocks = 0;
  while (!last && off + 4 <= buf.length) {
    const h = buf[off];
    last = (h & 0x80) !== 0;
    const size = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    blocks++;
    off += 4 + size;
  }
  check('块链结构完整', last && blocks >= 2, `blocks=${blocks} last=${last}`);
}

// ---------- 用例 2：二次写入（覆盖）不累积块 ----------
console.log('用例 2：重复写入（覆盖语义）');
{
  const f = path.join(dir, 'twice.flac');
  fs.writeFileSync(f, makeMinimalFlac());

  await writeTags(f, { title: '第一版', artist: 'A' });
  const size1 = fs.statSync(f).size;
  const r2 = await writeTags(f, { title: '第二版', artist: 'B', album: 'C' });
  const size2 = fs.statSync(f).size;

  check('第二次写入成功', r2.ok, JSON.stringify(r2));
  const md = await parseFile(f, { duration: false });
  check('标题已更新', md.common.title === '第二版', `得到 ${md.common.title}`);
  check('歌手已更新', md.common.artist === 'B', `得到 ${md.common.artist}`);
  check('旧 Vorbis 块被替换而非追加', size2 < size1 * 2, `size1=${size1} size2=${size2}`);
  check('音频帧仍完好', fs.readFileSync(f).includes(Buffer.from('FAKEFRAMEDATA')));
}

// ---------- 用例 3：封面嵌入 ----------
console.log('用例 3：封面嵌入');
{
  const f = path.join(dir, 'cover.flac');
  fs.writeFileSync(f, makeMinimalFlac());

  // 1x1 最小合法 JPEG
  const jpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

  const res = await writeTags(f, { title: '有封面', cover: { data: jpg, mime: 'image/jpeg' } });
  check('封面写入成功', res.ok, JSON.stringify(res));
  check('written 含 cover', res.written.includes('cover'));

  const md = await parseFile(f, { duration: false });
  check('能读回封面', (md.common.picture?.length ?? 0) > 0, `pictures=${md.common.picture?.length}`);
  check('封面 MIME 正确', md.common.picture?.[0]?.format === 'image/jpeg',
    `得到 ${md.common.picture?.[0]?.format}`);
}

// ---------- 用例 4：拒绝非 FLAC ----------
console.log('用例 4：非法输入防护');
{
  const f = path.join(dir, 'bad.flac');
  fs.writeFileSync(f, Buffer.from('NOT A FLAC FILE AT ALL'));
  const res = await writeTags(f, { title: 'x' });
  check('非 FLAC 被拒绝', !res.ok, JSON.stringify(res));
  check('原文件未被破坏', fs.readFileSync(f).toString() === 'NOT A FLAC FILE AT ALL');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
