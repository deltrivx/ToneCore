import { reactive, ref, computed } from 'vue';
import { api } from './useApi.js';

/**
 * 播放器状态（全局单例）。
 *
 * 分工：
 *   服务端 —— 队列、顺序、循环模式、当前曲目、音量（这些刷新后要保留）
 *   前端   —— <audio> 元素、播放进度、缓冲态（这些是本地资源，无法服务端持有）
 *
 * 同步方式：服务端返回的 playUrl 变化 → 前端换 src；播放进度只在本地管，
 * 不回传服务端（除非要做「多设备接续播放」，那是另一个量级的需求）。
 */

/** 循环模式 → 按钮图标与文案 */
export const REPEAT_META = {
  list:    { icon: '🔁', label: '列表循环' },
  single:  { icon: '🔂', label: '单曲循环' },
  shuffle: { icon: '🔀', label: '随机播放' },
};

const state = reactive({
  queue: [],
  index: -1,
  playing: false,
  repeat: 'list',
  playUrl: null,
  quality: null,
  volume: 80,

  /** 本地播放进度 */
  currentTime: 0,
  duration: 0,
  loading: false,
  /** 音频元素报错时的信息（直链过期等） */
  error: null,
  /** 全屏播放页是否展开 */
  expanded: false,
  /**
   * 底部「正在播放」上浮面板是否展开。
   * 与 expanded（全屏页）是两件事：这里是点底部播放条弹出的浮层，
   * 点空白处或收纳按钮都会收起。
   */
  sheetOpen: false,
  /** 歌词 */
  lyrics: { lines: [], source: 'none' },
  lyricIndex: -1,
});

/** 原生 audio 元素（懒创建，只有真正播放时才建） */
let audioEl = null;

function ensureAudio() {
  if (audioEl) return audioEl;
  if (typeof Audio === 'undefined') return null;   // SSR / 测试环境
  audioEl = new Audio();
  audioEl.preload = 'metadata';

  audioEl.addEventListener('timeupdate', () => {
    state.currentTime = audioEl.currentTime || 0;
    syncLyricIndex();
    scheduleProgressSave();
  });
  audioEl.addEventListener('durationchange', () => {
    state.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
  });
  audioEl.addEventListener('waiting', () => { state.loading = true; });
  audioEl.addEventListener('playing', () => { state.loading = false; state.playing = true; });
  audioEl.addEventListener('pause', () => { state.playing = false; saveProgressNow(); });
  audioEl.addEventListener('ended', () => { onEnded(); });
  audioEl.addEventListener('error', () => {
    state.loading = false;
    state.error = '音频加载失败（直链可能已过期，试试重新点播）';
  });
  return audioEl;
}

/** 自动播完 → 交给服务端决定下一首 */
async function onEnded() {
  // 单曲循环时服务端会原地返回同一首，前端手动 seek 回 0
  const before = state.index;
  const r = await api.playerNext(false);
  applyState(r);
  if (state.index === before && state.playUrl) {
    // 同一首重播：不换 src，直接归零
    const a = ensureAudio();
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
  }
}

/** 把服务端返回的状态合并进本地 state */
function applyState(r) {
  if (!r) return;
  const urlChanged = r.playUrl !== state.playUrl;
  if (r.queue) state.queue = r.queue;
  if (r.index !== undefined) state.index = r.index;
  if (r.repeat) state.repeat = r.repeat;
  if (r.volume !== undefined && r.volume !== state.volume) state.volume = r.volume;
  if (r.quality !== undefined) state.quality = r.quality;
  if (r.playing !== undefined) state.playing = r.playing;
  state.playUrl = r.playUrl ?? null;

  if (urlChanged) {
    state.currentTime = 0;
    state.duration = 0;
    state.error = null;
    state.lyricIndex = -1;
    const a = ensureAudio();
    if (a && state.playUrl) {
      state.loading = true;
      a.src = state.playUrl;
      a.volume = state.volume / 100;
      if (state.playing) a.play().catch(() => { /* 浏览器自动播放策略：等用户交互 */ });
    }
    loadLyrics();
  } else {
    const a = ensureAudio();
    if (a) {
      a.volume = state.volume / 100;
      if (state.playing && a.paused && state.playUrl) a.play().catch(() => {});
      if (!state.playing && !a.paused) a.pause();
    }
  }
}

/** 拉取当前曲目歌词 */
async function loadLyrics() {
  const cur = state.queue[state.index];
  state.lyrics = { lines: [], source: 'none' };
  if (!cur) return;
  try {
    const r = await api.lyrics({
      filePath: cur.filePath,
      title: cur.title,
      artist: cur.artist,
      platform: cur.platform,
      songId: cur.songId,
    });
    if (r && r.ok) state.lyrics = { lines: r.lines || [], source: r.source || 'none' };
  } catch { /* 歌词拿不到不影响播放 */ }
}

/** 依据当前时间算出高亮到第几行（歌词行数不多，线性扫足够） */
/**
 * 播放进度上报（跨设备续播的数据来源）。
 *
 * 为什么定义在模块顶层而不是 init() 里：放在 init/edit 内部时，
 * 这些函数只被 <audio> 事件回调引用，rollup 会把它们当成「未使用代码」删除，
 * 但外层 usePlayer() 的 return 仍引用着 —— 运行时报
 * ReferenceError: saveProgressNow is not defined，整个前端直接白屏。
 */
let lastSavedAt = 0;
let lastSavedSec = -1;

/** 节流保存：timeupdate 触发很密，别每次都写库 */
function scheduleProgressSave() {
  const now = Date.now();
  const sec = Math.floor(state.currentTime || 0);
  if (now - lastSavedAt < 5000 && Math.abs(sec - lastSavedSec) < 5) return;
  lastSavedAt = now;
  lastSavedSec = sec;
  saveProgressNow();
}

/** 立即落一次（切歌 / 暂停 / 页面隐藏时调，避免丢最后几秒） */
export function saveProgressNow() {
  const c = state.queue[state.index];
  if (!c) return;
  const key = c.filePath || c.songId || c.uid;
  if (!key) return;
  try {
    api.v1SaveProgress({
      songKey: String(key),
      songId: c.songId ? Number(c.songId) : null,
      title: c.title, artist: c.artist, album: c.album,
      positionMs: Math.round((state.currentTime || 0) * 1000),
      durationMs: Math.round((state.duration || 0) * 1000),
    });
  } catch { /* 进度丢失不致命，静默 */ }
}

function syncLyricIndex() {
  const lines = state.lyrics.lines;
  if (!lines.length) return;
  const t = state.currentTime + 0.25;      // 稍微提前，歌词更跟手
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  state.lyricIndex = ans;
}

export function usePlayer() {
  const current = computed(() => (state.index >= 0 ? state.queue[state.index] : null));

  /**
   * 当前曲目封面地址。
   *
   * 两种来源形态不同，统一在这里归一：
   *   - 本地曲库：`cover` 是服务端抽出的缓存文件名 → /cover/<名>
   *   - 在线歌曲：`coverUrl` 是平台给的完整地址
   * 组件里只认这一个计算属性，不必各自判断来源。
   */
  const coverUrl = computed(() => {
    const c = current.value;
    if (!c) return null;
    if (c.cover) return `/cover/${c.cover}`;
    if (c.coverUrl) return c.coverUrl;
    return null;
  });

  const hasNext = computed(() => state.queue.length > 1 || state.repeat === 'list');

  /** 用一组歌替换队列并从某首开始播 */
  async function playList(songs, index = 0) {
    const r = await api.playerQueue(songs, index);
    applyState(r);
    // 用户点击是「交互」，此时可以合法地启动播放
    if (r?.playUrl) {
      const a = ensureAudio();
      if (a) { a.src = state.playUrl; a.play().catch(() => {}); }
    }
    return r;
  }

  async function append(songs) {
    return applyState(await api.playerAppend(songs));
  }

  async function toggle() {
    const a = ensureAudio();
    if (!state.playUrl) return;
    const next = !state.playing;
    applyState(await api.playerPlaying(next));
    if (a) {
      if (next) a.play().catch(() => {});
      else a.pause();
    }
  }

  async function play() {
    if (state.playing) return;
    const a = ensureAudio();
    applyState(await api.playerPlaying(true));
    if (a && state.playUrl) { if (!a.src) a.src = state.playUrl; a.play().catch(() => {}); }
  }

  async function pause() {
    if (!state.playing) return;
    const a = ensureAudio();
    applyState(await api.playerPlaying(false));
    if (a) a.pause();
  }

  async function next() {
    applyState(await api.playerNext(true));
    const a = ensureAudio();
    if (a && state.playUrl) { a.src = state.playUrl; a.play().catch(() => {}); }
  }

  async function prev() {
    applyState(await api.playerPrev());
    const a = ensureAudio();
    if (a && state.playUrl) { a.src = state.playUrl; a.play().catch(() => {}); }
  }

  /** 跳到队列某下标 */
  async function jump(index) {
    applyState(await api.playerJump(index));
    const a = ensureAudio();
    if (a && state.playUrl) { a.src = state.playUrl; a.play().catch(() => {}); }
  }

  /** 拖动进度条 */
  function seek(seconds) {
    const a = ensureAudio();
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(seconds, state.duration || seconds));
    state.currentTime = a.currentTime;
    syncLyricIndex();
  }

  /** 调音量（0~100） */
  async function setVolume(v) {
    const a = ensureAudio();
    state.volume = Math.max(0, Math.min(100, Math.round(v)));
    if (a) a.volume = state.volume / 100;
    await api.playerVolume(state.volume);
  }

  /** 循环模式在三态间切换 */
  async function cycleRepeat() {
    const order = ['list', 'single', 'shuffle'];
    const nextMode = order[(order.indexOf(state.repeat) + 1) % order.length];
    applyState(await api.playerRepeat(nextMode));
  }

  async function removeAt(uid) {
    applyState(await api.playerRemove(uid));
  }

  async function clear() {
    const a = ensureAudio();
    if (a) { a.pause(); a.removeAttribute('src'); }
    applyState(await api.playerClear());
  }

  /** 首屏拉一次服务端状态（刷新后恢复队列） */
  async function init() {
    try {
      const r = await api.player();
      if (r) {
        state.queue = r.queue || [];
        state.index = r.index ?? -1;
        state.repeat = r.repeat || 'list';
        state.volume = r.volume ?? 80;
        state.quality = r.quality ?? null;
        // 刻意恢复为「暂停」：浏览器不允许无交互自动播放
        state.playing = false;
        state.playUrl = r.playUrl ?? null;
        if (state.queue.length) loadLyrics();
      }
    } catch { /* 首次启动服务端可能还没就绪 */ }
  }

  function toggleExpand() { state.expanded = !state.expanded; }

  /** 底部播放条 → 上浮「正在播放」面板 */
  function openSheet() { state.sheetOpen = true; }
  function closeSheet() { state.sheetOpen = false; }
  function toggleSheet() { state.sheetOpen = !state.sheetOpen; }

  /** 重新拉取服务端状态（服务端队列被其他接口改写后，用于对齐前端） */
  async function refresh() {
    try {
      const r = await api.player();
      if (r) applyState(r);
    } catch { /* 服务端可能短暂不可用 */ }
  }

  return {
    state,
    saveProgressNow, current, coverUrl, hasNext, REPEAT_META,
    init, playList, append, play, pause, toggle, next, prev, jump, seek,
    setVolume, cycleRepeat, removeAt, clear, toggleExpand, refresh,
    openSheet, closeSheet, toggleSheet,
  };
}

/** 格式化秒数为 m:ss */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
