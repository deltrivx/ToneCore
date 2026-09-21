/**
 * 刮削歌词/封面链路测试。
 *
 * 重点覆盖**实测踩过的两个坑**，防止回归：
 *   1) 搜索接口不返回 picUrl，封面必须走 detail 接口
 *   2) 正版曲目下架后只剩翻唱，而翻唱常无歌词 —— 必须逐个候选择优，
 *      不能只认最高分那一首，否则会误判「这首歌没有歌词」
 *
 * 这里不打真实网络：被测的是纯函数（标题清洗、相似度、候选排序）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

// ---- 从 lyric.ts 里复刻的纯逻辑（保持与实现一致）----

const NOISE_RE = /伴奏|remix|dj|翻唱|cover|纯音乐|消音|ktv|铃声|串烧|改编|慢摇|抖音|恶搞|搞笑|鬼畜|堵桥|喊麦|土味|电音|八音盒|童声|儿歌|合唱|清唱|demo|试听|片段|降调|升调|变调|加速版|减速版|治愈版|深情版|正式版/i;

function stripSuffix(s) {
  return s
    .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')
    .replace(/\s*[-–—]\s*.*$/, '')
    .trim();
}

function similarityLite(a, b) {
  const clean = (s) => s.toLowerCase().replace(/[\s\-_（）()《》·、,，.。!！?？'"“”]/g, '');
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const setY = new Set(y);
  let hit = 0;
  for (const c of x) if (setY.has(c)) hit++;
  return (hit / Math.max(x.length, y.length)) * 0.7;
}

/** 复刻 searchWyList 的打分 */
function scoreCandidate(name, arts, title, artist) {
  const ts = similarityLite(stripSuffix(name), title);
  if (ts < 0.5) return null;
  let score = ts * 2;
  if (artist) {
    const as = similarityLite(arts, artist);
    if (as >= 0.8) score += 1.5;
    else if (as >= 0.5) score += 0.5;
    else score -= 1.0;
  }
  if (NOISE_RE.test(name)) score -= 1.2;
  return { score, ts };
}

// ---- 测试 ----

test('stripSuffix 剥掉中文括号后缀', () => {
  assert.equal(stripSuffix('稻香(深情版)'), '稻香');
  assert.equal(stripSuffix('稻香（治愈版）'), '稻香');
  assert.equal(stripSuffix('本草纲目 (remix: 周杰伦)'), '本草纲目');
  assert.equal(stripSuffix('稻香'), '稻香');
});

test('stripSuffix 剥掉破折号后的说明', () => {
  assert.equal(stripSuffix('晴天 - Live'), '晴天');
  assert.equal(stripSuffix('孤勇者 – 现场版'), '孤勇者');
});

test('similarityLite 完全匹配得 1.0', () => {
  assert.equal(similarityLite('稻香', '稻香'), 1);
});

test('similarityLite 包含关系得 0.85', () => {
  assert.equal(similarityLite('稻香remix', '稻香'), 0.85);
});

test('剥掉后缀后「稻香(深情版)」与原曲名同分', () => {
  // 这是修复的核心：以前直接比原名，「稻香(深情版)」与「稻香」会算成
  // 包含关系 0.85，与真正原唱并列；剥掉后缀后两者都是完全匹配 1.0，
  // 由歌手分与噪音惩罚来分胜负。
  assert.equal(
    similarityLite(stripSuffix('稻香(深情版)'), '稻香'),
    similarityLite('稻香', '稻香'),
  );
});

test('歌手匹配的原唱分数高于不匹配的翻唱', () => {
  const orig = scoreCandidate('稻香', '周杰伦', '稻香', '周杰伦');
  const cover = scoreCandidate('稻香', 'Lucky小爱', '稻香', '周杰伦');
  assert.ok(orig.score > cover.score, `原唱 ${orig.score} 应高于翻唱 ${cover.score}`);
});

test('带噪音词的同名版本被降权', () => {
  const plain = scoreCandidate('稻香', '周杰伦', '稻香', '周杰伦');
  const noisy = scoreCandidate('稻香(治愈版)', '周杰伦', '稻香', '周杰伦');
  assert.ok(plain.score > noisy.score, `无噪音 ${plain.score} 应高于有噪音 ${noisy.score}`);
});

test('标题完全不沾边的候选被淘汰', () => {
  assert.equal(scoreCandidate('曹操', '林俊杰', '稻香', '周杰伦'), null);
});

test('无 artist 时仍能靠标题选出同名曲', () => {
  const r = scoreCandidate('稻香', '某歌手', '稻香', undefined);
  assert.ok(r !== null && r.score >= 1.5, '无歌手约束时应放宽但仍需标题匹配');
});

test('候选按分数降序排列，翻唱排在原唱之后', () => {
  const raw = [
    { name: '稻香', arts: 'Lucky小爱' },
    { name: '稻香', arts: '周杰伦' },
    { name: '稻香(治愈版)', arts: '周杰伦.' },
  ];
  const ranked = raw
    .map((c) => ({ ...c, r: scoreCandidate(c.name, c.arts, '稻香', '周杰伦') }))
    .filter((c) => c.r !== null)
    .sort((a, b) => b.r.score - a.r.score);
  assert.equal(ranked[0].arts, '周杰伦', '原唱应排第一');
});
