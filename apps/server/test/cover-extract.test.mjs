/**
 * 曲库封面抽取回归测试。
 *
 * 背景（真实缺陷）：`extractCovers` 曾经漏了 `await`。
 * `parseFile` 是异步的，漏掉 await 后拿到的是 Promise，
 * `md.common` 恒为 undefined → **每首歌都被判成「无封面」**，
 * 并且会被写成空串占位，之后永远不再重试。
 *
 * 这个测试用真实构造的音频文件（含内嵌封面）跑一遍，
 * 确保：① 能抽出封面；② 空串历史数据能自愈；③ 文件名是稳定的。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cover-'));
const MUSIC = path.join(TMP, 'music');
const DATA = path.join(TMP, 'data');
fs.mkdirSync(path.join(MUSIC, '测试歌手', '测试专辑'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

process.env.MUSIC_DIR = MUSIC;
process.env.DATA_DIR = DATA;

/**
 * 造一个带内嵌封面的最小 MP3。
 *
 * 不引第三方编码器：直接拼 ID3v2.3 头 + APIC 帧 + 一个极短的 MPEG 帧。
 * music-metadata 只解析标签，不校验音频数据是否合法，
 * 所以「能读出 picture」就足以验证抽取链路。
 */
function makeMp3WithCover(filePath) {
  // 一张 1x1 的 PNG（真实字节，非伪造）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );

  const frameBody = Buffer.concat([
    Buffer.from('image/png\0', 'latin1'),   // MIME，以 \0 结尾
    Buffer.from([0x03]),                     // 图片类型：封面
    Buffer.from('封面说明\0', 'utf8'),        // description，以 \0 结尾
    png,
  ]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write('APIC', 0, 'latin1');
  frameHeader.writeUInt32BE(frameBody.length, 4);   // 大小（不含本头）
  frameHeader.writeUInt16BE(0, 8);                  // 标志
  const frame = Buffer.concat([frameHeader, frameBody]);

  const tagHeader = Buffer.alloc(10);
  tagHeader.write('ID3', 0, 'latin1');
  tagHeader[3] = 3;    // 版本 2.3
  tagHeader[4] = 0;    // 修订
  tagHeader[5] = 0;    // 标志
  // 同步安全整数：每字节只用 7 位
  const n = frame.length;
  tagHeader[6] = (n >>> 21) & 0x7f;
  tagHeader[7] = (n >>> 14) & 0x7f;
  tagHeader[8] = (n >>> 7) & 0x7f;
  tagHeader[9] = n & 0x7f;

  // 极简 MPEG-1 Layer III 帧（0xFFFB + 静音数据），让文件看起来是音频
  const mpeg = Buffer.alloc(417);
  mpeg[0] = 0xff; mpeg[1] = 0xfb;

  fs.writeFileSync(filePath, Buffer.concat([tagHeader, frame, mpeg]));
  return png.length;
}

const SONG_REL = path.join('测试歌手', '测试专辑', '测试歌曲.mp3');
const coverBytes = makeMp3WithCover(path.join(MUSIC, SONG_REL));

const { Library } = require('../dist/services/library/index.js');

test('封面抽取：scan 后能抽出内嵌封面', async () => {
  const lib = new Library();
  const r = await lib.scan();
  assert.equal(r.total, 1, '应入库 1 首');

  const songs = lib.list(10, 0);
  assert.equal(songs.length, 1);
  const s = songs[0];
  assert.ok(s.cover, `cover 不应为空（实际 ${JSON.stringify(s.cover)}）`);
  assert.match(s.cover, /^[0-9a-f]{16}\.(png|jpg)$/, 'cover 应是 hash + 扩展名');
});

test('封面抽取：文件落地且字节与内嵌一致', () => {
  const lib = new Library();
  const s = lib.list(10, 0)[0];
  const abs = lib.coverPath(s.cover);
  assert.ok(abs, 'coverPath 应能解析出绝对路径');
  assert.ok(fs.existsSync(abs), '封面文件应存在于磁盘');
  const written = fs.readFileSync(abs);
  assert.equal(written.length, coverBytes, '封面字节数应与内嵌图片一致');
  assert.equal(written[0], 0x89, 'PNG 魔数首字节应为 0x89');
});

test('封面抽取：coverPath 拒绝路径穿越', () => {
  const lib = new Library();
  assert.equal(lib.coverPath('../../etc/passwd'), null, '越界路径必须被拒绝');
  assert.equal(lib.coverPath(''), null, '空名必须被拒绝');
});

test('封面抽取：空串历史数据能自愈（核心回归）', async () => {
  // 模拟旧版本留下的「已处理」空串占位 —— 这批数据本来永远不会再抽
  const Database = require('better-sqlite3');
  const dbPath = path.join(DATA, 'tonecore.db');
  const db = new Database(dbPath);
  const before = db.prepare('SELECT id, cover FROM songs').all();
  assert.ok(before.length > 0);
  db.prepare("UPDATE songs SET cover = ''").run();
  assert.equal(db.prepare("SELECT cover FROM songs").get().cover, '', '应已改成空串');
  db.close();

  // 再扫一次：空串应被重新处理，而不是被当成「已抽过」
  const lib = new Library();
  await lib.scan();
  const s = lib.list(10, 0)[0];
  assert.ok(s.cover && s.cover !== '', `空串占位应被自愈（实际 ${JSON.stringify(s.cover)}）`);
});

test('封面抽取：重复扫描不会重复抽取（幂等）', async () => {
  const lib = new Library();
  const r = await lib.scan();
  assert.equal(r.added, 0, '第二次扫描不应新增');
  const s = lib.list(10, 0)[0];
  assert.ok(s.cover, '封面应保持存在');
  const abs = lib.coverPath(s.cover);
  assert.ok(fs.existsSync(abs), '封面文件不应被删除');
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
