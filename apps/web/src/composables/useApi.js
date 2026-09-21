import { ref } from 'vue';

const BASE = '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: res.ok, raw: text }; }
}

export const api = {
  health:      () => req('/api/health'),
  config:      () => req('/api/config'),
  saveConfig:  (c) => req('/api/config', { method: 'POST', body: c }),
  library:     (limit = 50, offset = 0) => req(`/api/library?limit=${limit}&offset=${offset}`),
  scan:        () => req('/api/library/scan', { method: 'POST' }),
  sources:     () => req('/api/sources'),
  reloadSources: () => req('/api/sources/reload', { method: 'POST' }),
  search:      (kw) => req(`/api/search?keyword=${encodeURIComponent(kw)}`),
  play:        (kw, artist) => req('/api/play', { method: 'POST', body: { keyword: kw, artist } }),
  downloads:   () => req('/api/downloads'),
  audit:       (limit = 200) => req('/api/scraper/audit', { method: 'POST', body: { limit } }),
  speaker:        () => req('/api/speaker'),
  saveSpeaker:    (c) => req('/api/speaker/config', { method: 'POST', body: c }),
  speakerDevices: () => req('/api/speaker/devices', { method: 'POST' }),
  speakerPlay:    (deviceId, url) => req('/api/speaker/play', { method: 'POST', body: { deviceId, url } }),
  speakerSay:     (deviceId, text) => req('/api/speaker/say', { method: 'POST', body: { deviceId, text } }),
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
