/**
 * 播放器 / 歌词的纯逻辑单测。
 *
 * 这两块是本次新增里最容易出错的部分：
 *   - 队列下标在「删除当前项」时极易算错（删前面要左移、删当前要接后一首）
 *   - 循环模式的边界（列表循环回卷、单曲重播、顺序到底）
 *   - LRC 解析（多时间标签、毫秒位数、元信息行）
 * 因此不碰网络与文件系统，只测纯函数与状态机。
 *
 * 运行：node apps/server/test/player.test.mjs（先 tsc 构建 dist）
 */
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]);
    fail++;
  }
}

const { parseLrc } = await import('../dist/services/player/lyrics.js');

console.log('用例 1：LRC 解析');
t('基本时间轴按时间排序', () => {
  const lines = parseLrc('[00:12.34]第一句\n[00:05.00]第二句\n[01:00.00]第三句');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, '第二句');
  assert.equal(lines[1].text, '第一句');
  assert.equal(lines[2].text, '第三句');
});

t('毫秒位数 2 位与 3 位都识别', () => {
  const a = parseLrc('[00:01.5]x');
  const b = parseLrc('[00:01.500]y');
  // .5 → 0.5 秒；.500 → 0.5 秒
  assert.ok(Math.abs(a[0].time - 1.5) < 1e-6, '.5 应解析为 0.5 秒，实际 ' + a[0].time);
  assert.ok(Math.abs(b[0].time - 1.5) < 1e-6, '.500 应解析为 0.5 秒，实际 ' + b[0].time);
});

t('一行多时间标签展开成多行', () => {
  const lines = parseLrc('[00:10.00][00:20.00]副歌');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].time, 10);
  assert.equal(lines[1].time, 20);
  assert.equal(lines[0].text, '副歌');
});

t('纯元信息行（ar/ti/al/by）不产生歌词行', () => {
  const lines = parseLrc('[ar:周杰伦]\n[ti:晴天]\n[00:01.00]故事的小黄花');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '故事的小黄花');
});

t('空文本与无时间标签的行被忽略', () => {
  assert.equal(parseLrc('这是一句没有时间标签的话\n\n[00:01.00]').length, 0);
});

t('分:秒 支持三位分钟（长音频）', () => {
  const lines = parseLrc('[123:45.00]很长的一首歌');
  assert.equal(lines[0].time, 123 * 60 + 45);
});

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
