import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { logger } from './logger.js';
import { loadConfig, ensureDirs } from './config.js';
import { SourceEngine } from './services/source/index.js';
import { Downloader } from './services/download/index.js';
import { Library } from './services/library/index.js';
import { Scraper } from './services/scraper/index.js';
import { SpeakerService } from './services/speaker/index.js';
import { Orchestrator } from './services/orchestrator.js';
import { PlayerService } from './services/player/index.js';
import { LyricsService } from './services/player/lyrics.js';
import { registerRoutes } from './routes/index.js';

/** 探测本机对外 IPv4（用于生成推给音箱的绝对地址） */
function detectLanIP(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

// 兜底：脚本沙箱/第三方库的异常不允许带崩主进程
process.on('unhandledRejection', (reason) => {
  logger.warn({ err: String(reason).slice(0, 300) }, '未处理的 Promise 拒绝（已忽略）');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: String(err).slice(0, 300) }, '未捕获异常（已忽略，进程继续）');
});

async function main() {
  const cfg = loadConfig();
  ensureDirs(cfg);

  logger.info({ music: cfg.musicDir, data: cfg.dataDir, quality: cfg.quality }, 'ToneCore 启动中');

  const lib = new Library();
  const engine = new SourceEngine();
  const downloader = new Downloader(lib);
  const scraper = new Scraper();
  const speaker = new SpeakerService();
  const orchestrator = new Orchestrator(engine, downloader, lib);
  const player = new PlayerService(engine, lib);
  const lyrics = new LyricsService();

  // 下载完成后的标签/封面/歌词补齐
  downloader.attachScraper(scraper);

  const lanIP = process.env.PUBLIC_BASE || `http://${detectLanIP()}:${cfg.port}`;
  const publicBase = () => process.env.PUBLIC_BASE || `http://${lanIP.split('//')[1].split(':')[0]}:${cfg.port}`;

  await engine.reload();
  const scan = await lib.scan();
  logger.info({ sources: engine.sourceCount, songs: scan.total, publicBase: publicBase() }, '初始化完成');

  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  // 防御：允许「Content-Type: application/json 但体为空」的请求（如不带 body 的 DELETE/POST）。
  // 默认 Fastify 会抛 400 FST_ERR_CTP_EMPTY_JSON_BODY，导致删歌单/移除曲目被前端误判失败。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined || body === null) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error); }
  });
  await registerRoutes(app, { engine, downloader, lib, scraper, speaker, orchestrator, player, lyrics, publicBase });

  const webDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (/^\/(api|stream|proxy)/.test(req.url)) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ port: cfg.port }, 'ToneCore 已就绪');

  // 装配音箱（注册点歌回调）
  orchestrator.attachSpeaker(speaker, publicBase);
  if (speaker.enabled) {
    await speaker.refreshDevices().catch(() => {});
    speaker.startMonitor();
  }

  const shutdown = async () => {
    logger.info('正在关闭...');
    speaker.stopMonitor();
    await downloader.drain().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  logger.error({ err: String(e) }, '启动失败');
  process.exit(1);
});
