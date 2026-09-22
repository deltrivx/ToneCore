import { ref } from 'vue';

const BASE = '';
/** 访问令牌：登录后写入 localStorage，刷新后仍有效 */
const TOKEN_KEY = 'tc.token';
export const authState = ref({ token: localStorage.getItem(TOKEN_KEY) || '', user: null });

export function setToken(t) {
  authState.value.token = t || '';
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 隐私模式 */ }
}

async function req(path, opts = {}) {
  // 只在有 body 时才声明 application/json，否则 Fastify 会因「声明了 JSON 但体为空」
  // 抛出 400 FST_ERR_CTP_EMPTY_JSON_BODY，导致无 body 的 DELETE/POST（如删歌单、移除曲目）失败。
  const hasBody = opts.body !== undefined && opts.body !== null;
  const headers = hasBody ? { 'Content-Type': 'application/json' } : {};
  // 带上令牌（SongLoft 兼容层要求的 Bearer 鉴权）
  if (authState.value.token) headers['Authorization'] = 'Bearer ' + authState.value.token;
  const res = await fetch(BASE + path, {
    headers,
    ...opts,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  // 令牌失效：清掉并提示重新登录（避免界面停在「数据加载不出来」）
  if (res.status === 401) {
    setToken('');
    window.dispatchEvent(new CustomEvent('tc-unauthorized'));
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: res.ok, raw: text }; }
}

export const api = {
  // ---------- 认证（SongLoft 兼容：/api/v1/auth/*）----------
  v1Login:  (username, password) => req('/api/v1/auth/login', { method: 'POST', body: { username, password } }),
  v1Logout: () => req('/api/v1/auth/logout', { method: 'POST' }),
  v1Me:     () => req('/api/v1/me'),
  v1Health: () => req('/api/v1/health'),
  v1UpdateAccount: (patch) => req('/api/v1/account', { method: 'POST', body: patch }),
  // 播放进度：跨设备续播
  v1GetProgress: (songKey) => req('/api/v1/progress' + (songKey !== undefined ? '?songKey=' + encodeURIComponent(songKey) : '')),
  v1SaveProgress: (p) => req('/api/v1/progress', { method: 'POST', body: p }),
  v1Settings: () => req('/api/v1/settings'),
  v1SaveSettings: (kv) => req('/api/v1/settings', { method: 'POST', body: kv }),
  v1Version:() => req('/api/v1/version'),
  health:      () => req('/api/health'),
  config:      () => req('/api/config'),
  saveConfig:  (c) => req('/api/config', { method: 'POST', body: c }),

  library:     (limit = 50, offset = 0, keyword = '') =>
    req(`/api/library?limit=${limit}&offset=${offset}&keyword=${encodeURIComponent(keyword)}`),
  libraryStats: () => req('/api/library/stats'),
  libraryDelete: (filePath) => req('/api/library/delete', { method: 'POST', body: { filePath } }),
  scan:        () => req('/api/library/scan', { method: 'POST' }),
  libraryMissing: () => req('/api/library/missing'),
  libraryPrune:  () => req('/api/library/prune', { method: 'POST' }),

  sources:     () => req('/api/sources'),
  sourcesAll:  () => req('/api/sources/all'),
  sourcesHealth: () => req('/api/sources/health'),
  sourceToggle: (file, enabled) => req('/api/sources/toggle', { method: 'POST', body: { file, enabled } }),
  sourceDelete: (file) => req('/api/sources/delete', { method: 'POST', body: { file } }),
  sourceUpload: (filename, content) => req('/api/sources/upload', { method: 'POST', body: { filename, content } }),
  sourceTest:  (file, keyword) => req('/api/sources/test', { method: 'POST', body: { file, keyword } }),
  reloadSources: () => req('/api/sources/reload', { method: 'POST' }),

  search:      (kw, type = 'song') =>
    req(`/api/search?keyword=${encodeURIComponent(kw)}&type=${encodeURIComponent(type)}`),
  play:        (kw, artist) => req('/api/play', { method: 'POST', body: { keyword: kw, artist } }),
  downloads:   () => req('/api/downloads'),
  platforms:   () => req('/api/platforms'),

  // ---------- 播放器 ----------
  player:       () => req('/api/player'),
  playerQueue:  (songs, index = 0) => req('/api/player/queue', { method: 'POST', body: { songs, index } }),
  playerAppend: (songs) => req('/api/player/append', { method: 'POST', body: { songs } }),
  playerJump:   (index) => req('/api/player/jump', { method: 'POST', body: { index } }),
  playerNext:   (manual = true) => req('/api/player/next', { method: 'POST', body: { manual } }),
  playerPrev:   () => req('/api/player/prev', { method: 'POST' }),
  playerRepeat: (mode) => req('/api/player/repeat', { method: 'POST', body: { mode } }),
  playerPlaying:(playing) => req('/api/player/playing', { method: 'POST', body: { playing } }),
  playerVolume: (volume) => req('/api/player/volume', { method: 'POST', body: { volume } }),
  playerRemove: (uid) => req('/api/player/remove', { method: 'POST', body: { uid } }),
  playerClear:  () => req('/api/player/clear', { method: 'POST' }),

  /** 取歌词：本地歌传 filePath，在线歌传 title/artist */
  lyrics: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return req(`/api/lyrics?${qs}`);
  },

  audit:       (limit = 200) => req('/api/scraper/audit', { method: 'POST', body: { limit } }),
  backfill:    (limit = 20) => req('/api/scraper/backfill', { method: 'POST', body: { limit } }),
  scrapeSong:  (filePath) => req('/api/scraper/song', { method: 'POST', body: { filePath } }),

  // ---------- 歌单 ----------
  playlists:      () => req('/api/playlists'),
  playlistCreate: (name) => req('/api/playlists', { method: 'POST', body: { name } }),
  playlistDelete: (id) => req(`/api/playlists/${id}`, { method: 'DELETE' }),
  playlistGet:    (id) => req(`/api/playlists/${id}`),
  playlistAdd:    (id, songId) => req(`/api/playlists/${id}/tracks`, { method: 'POST', body: { songId } }),
  playlistAddMany:(id, songIds) => req(`/api/playlists/${id}/tracks`, { method: 'POST', body: { songIds } }),
  playlistRemove: (id, songId) => req(`/api/playlists/${id}/tracks/${songId}`, { method: 'DELETE' }),
  playlistPlay:   (id) => req(`/api/playlists/${id}/play`, { method: 'POST' }),

  speaker:        () => req('/api/speaker'),
  speakerLogin:   (username, password) => req('/api/speaker/login', { method: 'POST', body: { username, password } }),
  speakerVerify:  (b) => req('/api/speaker/verify', { method: 'POST', body: b }),
  speakerLogout:  () => req('/api/speaker/logout', { method: 'POST' }),
  saveSpeaker:    (c) => req('/api/speaker/config', { method: 'POST', body: c }),
  speakerDevices: () => req('/api/speaker/devices', { method: 'POST' }),
  speakerPlay:    (deviceId, url) => req('/api/speaker/play', { method: 'POST', body: { deviceId, url } }),
  speakerSay:     (deviceId, text) => req('/api/speaker/say', { method: 'POST', body: { deviceId, text } }),
  speakerControl: (deviceId, action) => req('/api/speaker/control', { method: 'POST', body: { deviceId, action } }),
  speakerVolume:  (body) => req('/api/speaker/volume', { method: 'POST', body }),
  speakerNow:     () => req('/api/speaker/now'),
};

export function useAsync(fn) {
  const loading = ref(false);
  const error = ref(null);
  const data = ref(null);
  const run = async (...args) => {
    loading.value = true; error.value = null;
    try { data.value = await fn(...args); return data.value; }
    catch (e) { error.value = String(e); throw e; }
    finally { loading.value = false; }
  };
  return { loading, error, data, run };
}
