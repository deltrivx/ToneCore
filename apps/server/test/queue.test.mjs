/**
 * 播放器状态机单测。
 *
 * 队列下标在「删除当前项」时极易算错，循环模式边界也容易写反，
 * 因此这里用一个假的 engine/lib 把纯顺序逻辑单独测掉。
 *
 * 运行：node apps/server/test/queue.test.mjs
 */
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); fail++; }
};

const { PlayerService } = await import('../dist/services/player/index.js');

/** 造一份可预测的假依赖：取链永远成功且返回固定地址 */
function makeFakeDeps() {
  const engine = {
    async getUrl(song) { return { url: `https://cdn.example/${song.id}.mp3`, quality: '320k', source: 'fake' }; },
  };
  const lib = { find: () => null };
  return { engine, lib };
}

const songs = (n) => Array.from({ length: n }, (_, i) => ({
  uid: `u${i}`, title: `歌${i}`, artist: `歌手${i}`,
  platform: 'kw', songId: `id${i}`, origin: 'remote',
}));

console.log('用例 1：基本入队与定位');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(5), 0);
  t('入队后 index=0 且有 playUrl', () => {
    const s = p.snapshot();
    assert.equal(s.index, 0);
    assert.ok(s.playUrl && s.playUrl.startsWith('/proxy'), 'playUrl=' + s.playUrl);
  });
  t('setQueue 指定 fromIndex 越界时收敛到末位', async () => {
    await p.setQueue(songs(3), 99);
    assert.equal(p.snapshot().index, 2);
  });
}

console.log('');
console.log('用例 2：列表循环');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(3), 0);
  t('初始 repeat=list', () => assert.equal(p.snapshot().repeat, 'list'));
  await p.next();
  t('next 前进到 1', () => assert.equal(p.snapshot().index, 1));
  await p.next();
  t('next 前进到 2', () => assert.equal(p.snapshot().index, 2));
  await p.next();
  t('末尾 next 回卷到 0（列表循环）', () => assert.equal(p.snapshot().index, 0));
  await p.prev();
  t('首位 prev 回卷到末位', () => assert.equal(p.snapshot().index, 2));
}

console.log('');
console.log('用例 3：单曲循环');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(3), 1);
  await p.setRepeat('single');
  await p.next(false);
  t('自动播完（manual=false）停在原地', () => assert.equal(p.snapshot().index, 1));
  await p.next(true);
  t('手动点下一首仍会前进', () => assert.equal(p.snapshot().index, 2));
}

console.log('');
console.log('用例 4：顺序播完到底停下');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(2), 0);
  // 把模式改成非 list 才能观察「到底停住」；
  // 这里直接用 single 但 manual=true 让它前进
  await p.setRepeat('single');
  await p.next(true);
  t('前进到末位', () => assert.equal(p.snapshot().index, 1));
  // 回到 list 之外的单曲模式，自动播完不前进 → 用 autoNext 语义
  const before = p.snapshot().index;
  await p.next(false);
  t('单曲模式自动播完不换歌', () => assert.equal(p.snapshot().index, before));
}

console.log('');
console.log('用例 5：随机模式不原地重复');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(10), 0);
  await p.setRepeat('shuffle');
  let same = 0;
  for (let i = 0; i < 30; i++) {
    const before = p.snapshot().index;
    await p.next(true);
    if (p.snapshot().index === before) same++;
  }
  t('连续 30 次随机切歌均未原地重复', () => assert.equal(same, 0, '出现 ' + same + ' 次原地重复'));
  t('随机切歌后 index 始终合法', () => {
    const i = p.snapshot().index;
    assert.ok(i >= 0 && i < 10, 'index=' + i);
  });
}

console.log('');
console.log('用例 6：删除队列项的下标修正');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(5), 3);
  t('起点 index=3', () => assert.equal(p.snapshot().index, 3));

  p.remove('u1');                        // 删前面的项
  t('删前面的项 → index 左移到 2', () => assert.equal(p.snapshot().index, 2));
  t('队列长度变 4', () => assert.equal(p.snapshot().queue.length, 4));

  const curUid = p.snapshot().queue[p.snapshot().index].uid;
  p.remove(curUid);                      // 删当前项
  t('删当前项 → 原地接上后一首，下标不变', () => {
    const s = p.snapshot();
    assert.equal(s.index, 2);
    assert.notEqual(s.queue[2].uid, curUid, '当前项应已换成别的歌');
  });

  // 删到只剩一项再删空
  for (const it of [...p.snapshot().queue]) p.remove(it.uid);
  t('全部删完 → index=-1 且 playUrl=null', () => {
    const s = p.snapshot();
    assert.equal(s.queue.length, 0);
    assert.equal(s.index, -1);
    assert.equal(s.playUrl, null);
  });
}

console.log('');
console.log('用例 7：删当前项在末尾时向前收敛');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  await p.setQueue(songs(3), 2);         // 停在末位
  const curUid = p.snapshot().queue[2].uid;
  p.remove(curUid);
  t('删末尾的当前项 → index 收敛到新的末位（1）', () => {
    const s = p.snapshot();
    assert.equal(s.queue.length, 2);
    assert.equal(s.index, 1);
    assert.ok(s.playUrl, '应当已为新当前项解析出地址');
  });
}

console.log('');
console.log('用例 8：音量与 append');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  t('音量越界被截断到 0~100', () => {
    assert.equal(p.setVolume(300).volume, 100);
    assert.equal(p.setVolume(-50).volume, 0);
    assert.equal(p.setVolume(42.6).volume, 43);
  });

  await p.setQueue(songs(2), 0);
  p.append(songs(3));
  t('append 追加 3 首 → 共 5 首且当前不变', () => {
    const s = p.snapshot();
    assert.equal(s.queue.length, 5);
    assert.equal(s.index, 0);
  });
}

console.log('');
console.log('用例 9：空队列操作安全');
{
  const p = new PlayerService(...Object.values(makeFakeDeps()));
  t('空队列 next 不抛错', () => { p.next(); });
  t('空队列 prev 不抛错', () => { p.prev(); });
  t('空队列 remove 未知 uid 不抛错', () => { p.remove('nope'); });
  t('空队列 playing 不允许置真', () => {
    p.setPlaying(true);
    assert.equal(p.snapshot().playing, false);
  });
}

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
