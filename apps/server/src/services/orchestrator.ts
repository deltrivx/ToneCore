import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { loadConfig } from '../config.js';
import type { SourceEngine } from './source/index.js';
import type { Downloader } from './download/index.js';
import type { Library } from './library/index.js';
import type { SpeakerService, ParsedCommand } from './speaker/index.js';

export interface PlayResolution {
  playUrl: string;
  origin: 'local' | 'remote';
  title: string;
  artist: string;
  fetching: boolean;
  /** 内部用：是否推送到音箱 */
  pushed?: boolean;
}

/**
 * 中枢编排：本地优先 → 命中直接播；未命中走音源并异步落库。
 */
export class Orchestrator {
  private speaker: SpeakerService | null = null;

  constructor(
    private engine: SourceEngine,
    private downloader: Downloader,
    private lib: Library,
  ) {}

  /** 装配音箱服务并注册点歌回调 */
  attachSpeaker(speaker: SpeakerService, publicBase: () => string) {
    this.speaker = speaker;
    speaker.onCommandHandler(async (cmd, deviceId, raw) => {
      await this.handleVoiceCommand(cmd, deviceId, raw, publicBase);
    });
  }

  /** 处理来自音箱的语音指令 */
  private async handleVoiceCommand(
    cmd: ParsedCommand,
    deviceId: string,
    raw: string,
    publicBase: () => string,
  ): Promise<void> {
    if (!this.speaker) return;

    switch (cmd.action) {
      case 'play': {
        if (!cmd.keyword) return;
        const r = await this.resolveAndPlay(cmd.keyword, cmd.artist);
        if (!r) {
          await this.speaker.say(deviceId, '抱歉，没有找到这首歌');
          return;
        }
        // 推绝对地址给音箱
        const abs = publicBase().replace(/\/$/, '') + r.playUrl;
        const ok = await this.speaker.play(deviceId, abs);
        logger.info({ raw, title: r.title, artist: r.artist, origin: r.origin, ok }, '语音点歌完成');
        break;
      }
      case 'volume': {
        logger.info({ deviceId, volume: cmd.volume }, '音量调整（待协议层实现）');
        break;
      }
      case 'next':
      case 'prev':
      case 'pause':
      case 'stop':
        logger.info({ deviceId, action: cmd.action }, '播放控制（待协议层实现）');
        break;
      default:
        break;
    }
  }

  async resolveAndPlay(keyword: string, artist?: string, quality?: string): Promise<PlayResolution | null> {
    const cfg = loadConfig();

    // 1) 本地优先
    const local = this.lib.find(keyword, artist);
    if (local) {
      logger.info({ title: local.title, artist: local.artist }, '本地曲库命中');
      return {
        playUrl: `/stream/${encodeURIComponent(local.filePath)}`,
        origin: 'local',
        title: local.title,
        artist: local.artist,
        fetching: false,
      };
    }

    // 2) 走音源
    const hit = await this.engine.resolve(keyword, artist, quality);
    if (!hit) return null;

    // 3) 异步落库（不阻塞播放返回）
    let fetching = false;
    if (cfg.autoFetch) {
      this.downloader.enqueue(hit.song, hit.url);
      fetching = true;
    }

    return {
      playUrl: `/proxy?url=${encodeURIComponent(hit.url.url)}`,
      origin: 'remote',
      title: hit.song.title,
      artist: hit.song.artist,
      fetching,
    };
  }

  /** 本地文件流（供 /stream 路由） */
  streamPath(relPath: string): { abs: string; size: number } | null {
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(root)) return null;      // 防目录穿越
    if (!fs.existsSync(abs)) return null;
    return { abs, size: fs.statSync(abs).size };
  }
}
