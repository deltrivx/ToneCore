import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import PQueue from 'p-queue';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import type { Library } from '../library/index.js';
import type { Song, SongUrl } from '../source/types.js';

/** 音频 magic number 校验：确认下到的是音频而不是 HTML 错误页 */
function sniffAudio(head: Buffer): { ok: boolean; ext: string; mime: string } {
  const hex = head.subarray(0, 4).toString('hex');
  if (hex.startsWith('664c6143')) return { ok: true, ext: '.flac', mime: 'audio/flac' };   // fLaC
  if (hex.startsWith('494433')) return { ok: true, ext: '.mp3', mime: 'audio/mpeg' };      // ID3
  if (hex.startsWith('fff3') || hex.startsWith('fffb')) return { ok: true, ext: '.mp3', mime: 'audio/mpeg' };
  if (hex.startsWith('4f676753')) return { ok: true, ext: '.ogg', mime: 'audio/ogg' };    // OggS
  if (hex.startsWith('52494646')) return { ok: true, ext: '.wav', mime: 'audio/wav' };    // RIFF
  // m4a / mp4: 第 4~8 字节是 ftyp
  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { ok: true, ext: '.m4a', mime: 'audio/mp4' };
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

  constructor(lib: Library) {
    const cfg = loadConfig();
    this.lib = lib;
    this.queue = new PQueue({
      concurrency: cfg.downloadConcurrency,
      interval: cfg.downloadIntervalMs,
      intervalCap: 1,          // 每个间隔只放行 1 个任务，严格防风控
    });
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

      // 先读前 512 字节做格式嗅探
      const reader = res.body.getReader();
      const first = await reader.read();
      if (first.done || !first.value) throw new Error('响应体为空');
      const head = Buffer.from(first.value);

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

      // 落盘（流式，先写临时文件再原子改名）
      const tmp = absFile + '.part';
      const nodeStream = Readable.fromWeb(res.body as any);
      await pipeline(Readable.from([head]).pipe(nodeStream), fs.createWriteStream(tmp));
      fs.renameSync(tmp, absFile);

      const size = fs.statSync(absFile).size;
      logger.info({
        title: song.title, artist: song.artist, file: relFile,
        sizeMB: +(size / 1048576).toFixed(1), quality: url.quality,
        source: url.source, ms: Date.now() - t0,
      }, '下载完成并落库');

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
