import fs from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import type { Library } from '../library/index.js';
import type { Scraper } from '../scraper/index.js';
import type { Song, SongUrl } from '../source/types.js';

/** 音频 magic number 校验：确认下到的是音频而不是 HTML 错误页 */
function sniffAudio(head: Buffer): { ok: boolean; ext: string; mime: string } {
  const hex = head.subarray(0, 4).toString('hex');
  // FLAC: fLaC
  if (hex.startsWith('664c6143')) return { ok: true, ext: '.flac', mime: 'audio/flac' };
  // MP3: ID3v2 标签（ID3\x02/\x03/\x04）或裸帧同步字
  if (hex.startsWith('494433')) return { ok: true, ext: '.mp3', mime: 'audio/mpeg' };
  if (hex.startsWith('fff2') || hex.startsWith('fff3') || hex.startsWith('fffb') || hex.startsWith('fffa')) {
    return { ok: true, ext: '.mp3', mime: 'audio/mpeg' };
  }
  // AAC ADTS
  if (hex.startsWith('fff1')) return { ok: true, ext: '.aac', mime: 'audio/aac' };
  // Ogg / WAV / APE
  if (hex.startsWith('4f676753')) return { ok: true, ext: '.ogg', mime: 'audio/ogg' };
  if (hex.startsWith('52494646')) return { ok: true, ext: '.wav', mime: 'audio/wav' };
  if (hex.startsWith('4d414320')) return { ok: true, ext: '.ape', mime: 'audio/x-ape' };   // MAC 
  // m4a / mp4: 第 4~8 字节为 ftyp
  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { ok: true, ext: '.m4a', mime: 'audio/mp4' };
  }
  // WMA / ASF
  if (head.length >= 16 && head.subarray(0, 16).toString('hex').startsWith('3026b2758e66cf11')) {
    return { ok: true, ext: '.wma', mime: 'audio/x-ms-wma' };
  }
  return { ok: false, ext: '', mime: '' };
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 下载器：串行队列 + 风控间隔 + 音频校验 + 路径模板归档。
 */
export class Downloader {
  private queue: PQueue;
  private lib: Library;
  private scraper: Scraper | null = null;

  constructor(lib: Library) {
    const cfg = loadConfig();
    this.lib = lib;
    this.queue = new PQueue({
      concurrency: cfg.downloadConcurrency,
      interval: cfg.downloadIntervalMs,
      intervalCap: 1,          // 每个间隔只放行 1 个任务，严格防风控
    });
  }

  /**
   * 注入刮削服务。
   *
   * 用注入而不是构造参数，是为了打破 Downloader ↔ Scraper 的循环装配：
   * 两者都需要 Library，而 Scraper 又只想在读元数据时才被用到。
   * 未注入时下载照常进行，只是不写标签。
   */
  attachScraper(scraper: Scraper) {
    this.scraper = scraper;
  }

  /** 队列状态 */
  status() {
    return {
      pending: this.queue.pending,
      size: this.queue.size,
    };
  }

  /** 加入下载队列（不阻塞调用方） */
  enqueue(song: Song, url: SongUrl): void {
    logger.info({ title: song.title, artist: song.artist, queue: this.queue.size + 1 }, '加入下载队列');
    this.queue.add(() => this.download(song, url)).catch((e) => {
      logger.error({ err: String(e), title: song.title }, '下载任务异常');
    });
  }

  /** 实际下载 + 落库 */
  private async download(song: Song, url: SongUrl): Promise<void> {
    const cfg = loadConfig();
    const t0 = Date.now();

    try {
      const res = await fetch(url.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // 用 asyncIterator 读前若干字节做格式嗅探（不锁流，后续还能继续读）
      const chunks: Buffer[] = [];
      let headLen = 0;
      const iterator = (res.body as any)[Symbol.asyncIterator]();
      while (headLen < 512) {
        const { value, done } = await iterator.next();
        if (done) break;
        const buf = Buffer.from(value);
        chunks.push(buf);
        headLen += buf.length;
      }
      const head = Buffer.concat(chunks);
      if (head.length === 0) throw new Error('响应体为空');

      const sniff = sniffAudio(head);
      if (!sniff.ok) {
        const snippet = head.subarray(0, 80).toString('utf8').replace(/\n/g, ' ');
        throw new Error(`非音频内容: ${snippet}`);
      }

      // 归档路径
      const rel = cfg.pathTemplate
        .replace('{artist}', sanitize(song.artist || '未知歌手'))
        .replace('{album}', sanitize(song.album || '未知专辑'))
        .replace('{title}', sanitize(song.title || '未知歌曲'));
      const relFile = rel + sniff.ext;
      const absFile = path.join(cfg.musicDir, relFile);
      fs.mkdirSync(path.dirname(absFile), { recursive: true });

      // 落盘（写临时文件 → 原子改名）
      const tmp = absFile + '.part';
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, head);                       // 已读到的头部
        for (;;) {                                    // 继续读剩余
          const { value, done } = await iterator.next();
          if (done) break;
          fs.writeSync(fd, Buffer.from(value));
        }
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, absFile);

      const size = fs.statSync(absFile).size;
      logger.info({
        title: song.title, artist: song.artist, file: relFile,
        sizeMB: +(size / 1048576).toFixed(1), quality: url.quality,
        source: url.source, ms: Date.now() - t0,
      }, '下载完成并落库');

      // 刮削：补齐标签 / 封面 / 歌词。
      // 刻意放在落库之后、且吞掉异常 —— 刮削失败（网络不通、接口变动）
      // 绝不能把一次成功的下载判成失败。
      if (this.scraper) {
        try {
          await this.scraper.applyToFile(absFile, song, {
            platform: song.platform,
            songId: song.id,
            coverUrl: song.coverUrl,
            album: song.album,
            duration: song.duration,
          });
        } catch (e) {
          logger.warn({ file: relFile, err: String(e).slice(0, 200) }, '刮削失败（不影响落库结果）');
        }
      }

      // 同步进曲库索引
      this.lib.scan();
      this.lib.log({
        title: song.title, artist: song.artist, platform: song.platform,
        quality: url.quality, filePath: relFile, status: 'success',
      });
    } catch (e) {
      const msg = String(e).slice(0, 300);
      logger.warn({ title: song.title, artist: song.artist, err: msg }, '下载失败');
      this.lib.log({
        title: song.title, artist: song.artist, platform: song.platform,
        quality: url.quality, status: 'failed', message: msg,
      });
    }
  }

  /** 等待队列清空（健康检查/脚本用） */
  async drain(): Promise<void> {
    await this.queue.onIdle();
  }
}
