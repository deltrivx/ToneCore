import path from 'node:path';
import fs from 'node:fs';
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
import { registerRoutes } from './routes/index.js';

async function main() {
  const cfg = loadConfig();
  ensureDirs(cfg);

  logger.info({ music: cfg.musicDir, data: cfg.dataDir, quality: cfg.quality }, 'ToneCore 启动中');

  // 服务装配
  const lib = new Library();
  const engine = new SourceEngine();
  const downloader = new Downloader(lib);
  const scraper = new Scraper();
  const speaker = new SpeakerService();
  const orchestrator = new Orchestrator(engine, downloader, lib);

  // 音源加载 + 曲库扫描
  engine.reload();
  const scan = lib.scan();
  logger.info({ sources: engine.sourceCount, songs: scan.total }, '初始化完成');

  // HTTP 服务
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  await registerRoutes(app, { engine, downloader, lib, scraper, speaker, orchestrator });

  // 前端静态资源
  const webDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/stream') || req.url.startsWith('/proxy')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ port: cfg.port }, 'ToneCore 已就绪');

  speaker.startMonitor();

  const shutdown = async () => {
    logger.info('正在关闭...');
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
