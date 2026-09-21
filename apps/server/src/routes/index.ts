import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig } from '../config.js';
import type { SourceEngine } from '../services/source/index.js';
import type { Downloader } from '../services/download/index.js';
import type { Library } from '../services/library/index.js';
import type { Scraper } from '../services/scraper/index.js';
import type { SpeakerService } from '../services/speaker/index.js';
import type { Orchestrator } from '../services/orchestrator.js';

export interface Deps {
  engine: SourceEngine;
  downloader: Downloader;
  lib: Library;
  scraper: Scraper;
  speaker: SpeakerService;
  orchestrator: Orchestrator;
  /** 对外访问地址（推给音箱用） */
  publicBase: () => string;
}

export async function registerRoutes(app: FastifyInstance, d: Deps) {
  // ---------- 健康检查 ----------
  app.get('/api/health', async () => ({
    ok: true,
    version: '0.1.0',
    sources: d.engine.sourceCount,
    library: d.lib.count(),
    queue: d.downloader.status(),
    speaker: d.speaker.status.enabled,
    devices: d.speaker.status.deviceCount,
  }));

  // ---------- 配置 ----------
  app.get('/api/config', async () => loadConfig());
  app.post('/api/config', async (req) => ({ ok: true, config: saveConfig(req.body as any) }));

  // ---------- 曲库 ----------
  app.get('/api/library', async (req) => {
    const q = req.query as any;
    return { total: d.lib.count(), songs: d.lib.list(Number(q.limit) || 50, Number(q.offset) || 0) };
  });
  app.post('/api/library/scan', async () => d.lib.scan());

  // ---------- 音源 ----------
  app.get('/api/sources', async () => ({ count: d.engine.sourceCount, sources: d.engine.listSources() }));
  app.post('/api/sources/reload', async () => {
    d.engine.reload();
    return { ok: true, count: d.engine.sourceCount };
  });

  // ---------- 搜索 ----------
  app.get('/api/search', async (req) => {
    const q = req.query as any;
    const keyword = String(q.keyword || '').trim();
    if (!keyword) return { ok: false, error: '缺少 keyword' };
    const groups = await d.engine.searchAll(keyword, q.platforms ? String(q.platforms).split(',') : undefined);
    return { ok: true, keyword, platforms: Object.fromEntries([...groups].map(([k, v]) => [k, v.slice(0, 20)])) };
  });

  // ---------- 点歌（核心） ----------
  app.post('/api/play', async (req) => {
    const b = req.body as any;
    const keyword = String(b?.keyword || '').trim();
    if (!keyword) return { ok: false, error: '缺少 keyword' };
    const r = await d.orchestrator.resolveAndPlay(keyword, b.artist, b.quality);
    if (!r) return { ok: false, error: '未找到可播放音源' };

    // 可选：同时推送到音箱
    if (b.deviceId && d.speaker.status.enabled) {
      const abs = d.publicBase().replace(/\/$/, '') + r.playUrl;
      r.pushed = await d.speaker.play(String(b.deviceId), abs);
    }
    return { ok: true, ...r };
  });

  // ---------- 下载队列 ----------
  app.get('/api/downloads', async () => ({ queue: d.downloader.status(), logs: d.lib.recentLogs(30) }));

  // ---------- 刮削 ----------
  app.post('/api/scraper/audit', async (req) => d.scraper.audit(Number((req.body as any)?.limit) || 200));

  // ---------- 音箱 ----------
  app.get('/api/speaker', async () => d.speaker.status);
  app.post('/api/speaker/config', async (req) => {
    d.speaker.configure(req.body as any);
    return d.speaker.status;
  });
  app.post('/api/speaker/devices', async () => ({ devices: await d.speaker.refreshDevices() }));
  app.post('/api/speaker/play', async (req) => {
    const b = req.body as any;
    return { ok: await d.speaker.play(String(b.deviceId || ''), String(b.url || '')) };
  });
  app.post('/api/speaker/say', async (req) => {
    const b = req.body as any;
    return { ok: await d.speaker.say(String(b.deviceId || ''), String(b.text || '')) };
  });

  // ---------- 本地文件流 ----------
  app.get('/stream/*', async (req, reply) => {
    const rel = decodeURIComponent((req.params as any)['*'] || '');
    const hit = d.orchestrator.streamPath(rel);
    if (!hit) return reply.code(404).send({ error: 'not found' });

    const ext = rel.split('.').pop()?.toLowerCase();
    const mime = ext === 'flac' ? 'audio/flac'
      : ext === 'mp3' ? 'audio/mpeg'
      : ext === 'm4a' ? 'audio/mp4'
      : ext === 'wav' ? 'audio/wav'
      : ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m?.[1] || 0);
      const end = m?.[2] ? Number(m[2]) : hit.size - 1;
      reply.code(206)
        .header('Content-Range', `bytes ${start}-${end}/${hit.size}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', end - start + 1)
        .header('Content-Type', mime);
      return reply.send(fs.createReadStream(hit.abs, { start, end }));
    }
    reply.header('Content-Length', hit.size).header('Content-Type', mime).header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(hit.abs));
  });

  // ---------- 在线直链代理 ----------
  app.get('/proxy', async (req, reply) => {
    const url = String((req.query as any).url || '');
    if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'invalid url' });
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', ...(req.headers.range ? { Range: req.headers.range } : {}) },
      });
      const h: Record<string, string> = {};
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = res.headers.get(k);
        if (v) h[k] = v;
      }
      reply.code(res.status).headers(h);
      if (!res.body) return reply.send();
      return reply.send(Readable.fromWeb(res.body as any));
    } catch (e) {
      return reply.code(502).send({ error: String(e) });
    }
  });
}
