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

/** 每台设备当前的播放上下文（用于上/下一首） */
interface PlaySession {
  /** 当前播放的歌名 */
  title: string;
  artist: string;
  /** 解析时的原始关键词，用于「下一首」找不到同专辑时的回退搜索 */
  keyword: string;
  /** 播放地址（绝对地址，可直接重推） */
  absUrl: string;
  origin: 'local' | 'remote';
  /** 该次点歌返回的全部候选，用于 next/prev 在候选间切换 */
  queue: { title: string; artist: string; playUrl: string }[];
  index: number;
  updatedAt: number;
}

/**
 * 中枢编排：本地优先 → 命中直接播；未命中走音源并异步落库。
 */
export class Orchestrator {
  private speaker: SpeakerService | null = null;

  /**
   * 每台设备一份播放上下文。
   *
   * 为什么需要：语音喊「下一首」时，音箱自己不知道我们推的是个直链，
   * 它没有播放列表概念 —— 必须由中枢记住「刚才是谁点的、搜索结果有哪些」，
   * 才能自己算下一首并重新推流。
   */
  private sessions = new Map<string, PlaySession>();

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
        if (ok) this.rememberSession(deviceId, r, cmd, abs, publicBase);
        logger.info({ raw, title: r.title, artist: r.artist, origin: r.origin, ok }, '语音点歌完成');
        break;
      }

      case 'volume': {
        if (cmd.volumeDelta !== undefined) {
          const ok = await this.speaker.nudgeVolume(deviceId, cmd.volumeDelta);
          logger.info({ deviceId, delta: cmd.volumeDelta, ok }, '音量相对调节');
        } else if (cmd.volume !== undefined) {
          const ok = await this.speaker.setVolume(deviceId, cmd.volume);
          logger.info({ deviceId, volume: cmd.volume, ok }, '音量已设置');
        }
        break;
      }

      // 上/下一首：在本次点歌的候选列表里切换，切不动就重新搜一次
      case 'next':
        await this.shiftQueue(deviceId, +1, publicBase, raw);
        break;
      case 'prev':
        await this.shiftQueue(deviceId, -1, publicBase, raw);
        break;

      case 'pause':
        logger.info({ deviceId, ok: await this.speaker.control(deviceId, 'pause') }, '暂停指令已下发');
        break;
      case 'resume':
        logger.info({ deviceId, ok: await this.speaker.control(deviceId, 'play') }, '继续播放指令已下发');
        break;
      case 'stop':
        logger.info({ deviceId, ok: await this.speaker.control(deviceId, 'stop') }, '停止指令已下发');
        this.sessions.delete(deviceId);
        break;

      default:
        break;
    }
  }

  /** 记录一次点歌的播放上下文 */
  private rememberSession(
    deviceId: string,
    r: PlayResolution,
    cmd: ParsedCommand,
    absUrl: string,
    publicBase: () => string,
  ) {
    const prev = this.sessions.get(deviceId);
    // 同一关键词的连续点歌视为「同一批队列」，保留原队列位置信息
    const sameQuery = prev && prev.keyword === (cmd.keyword || '') && prev.artist === (cmd.artist || '');
    const queue = sameQuery && prev!.queue.length
      ? prev!.queue
      : [{ title: r.title, artist: r.artist, playUrl: absUrl }];

    this.sessions.set(deviceId, {
      title: r.title,
      artist: r.artist,
      keyword: cmd.keyword || '',
      absUrl,
      origin: r.origin,
      queue,
      index: sameQuery ? prev!.index : 0,
      updatedAt: Date.now(),
    });
    void publicBase;   // 队列后续项在 shiftQueue 时才补地址
  }

  /**
   * 上/下一首。
   *
   * 策略：优先在已记住的队列里移动；队列到边界时，重新跑一次搜索把该关键词的
   * 候选补齐（按分数排序后逐个试），这样「下一首」在只有一首歌命中时也有意义 ——
   * 会切到同一关键词的其他匹配项，而不是原地不动。
   */
  private async shiftQueue(
    deviceId: string,
    step: 1 | -1,
    publicBase: () => string,
    raw: string,
  ): Promise<void> {
    if (!this.speaker) return;
    const s = this.sessions.get(deviceId);
    if (!s) {
      logger.info({ deviceId, raw }, '无播放上下文，下一首指令转交音箱自身处理');
      // 没有上下文就不要瞎猜 —— 直接让音箱自己切，它的播放列表可能还有内容
      await this.speaker.control(deviceId, step > 0 ? 'next' : 'prev');
      return;
    }

    let next = s.queue[s.index + step];

    // 队列边界：重新搜索补齐候选
    if (!next) {
      const r = await this.resolveAndPlay(s.keyword, s.artist || undefined);
      if (r) {
        const abs = publicBase().replace(/\/$/, '') + r.playUrl;
        // 重新解析出的结果若与当前相同，说明只有一个匹配，别再原地重推
        if (r.title === s.title && r.artist === s.artist) {
          logger.info({ deviceId, title: s.title }, '队列无更多候选，回退音箱自身切歌');
          await this.speaker.control(deviceId, step > 0 ? 'next' : 'prev');
          return;
        }
        next = { title: r.title, artist: r.artist, playUrl: abs };
        s.queue.push(next);
        s.index = s.queue.length - 1;
      } else {
        logger.info({ deviceId, keyword: s.keyword }, '队列已到头且无新候选，转交音箱自身处理');
        await this.speaker.control(deviceId, step > 0 ? 'next' : 'prev');
        return;
      }
    } else {
      s.index += step;
    }

    const ok = await this.speaker.play(deviceId, next.playUrl);
    if (ok) {
      s.title = next.title;
      s.artist = next.artist;
      s.absUrl = next.playUrl;
      s.updatedAt = Date.now();
    }
    logger.info(
      { deviceId, action: step > 0 ? 'next' : 'prev', title: next.title, artist: next.artist, ok },
      '切歌完成',
    );
  }

  /**
   * 解析并返回可播地址。
   *
   * 注意：这里返回的 playUrl 是**相对路径**，调用方负责拼绝对地址。
   */
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

  /** 当前播放上下文（供控制台展示） */
  sessionSnapshot(): Record<string, { title: string; artist: string; origin: string; queueIndex: number; queueSize: number }> {
    const out: Record<string, any> = {};
    for (const [did, s] of this.sessions) {
      out[did] = {
        title: s.title, artist: s.artist, origin: s.origin,
        queueIndex: s.index, queueSize: s.queue.length,
      };
    }
    return out;
  }

  /** 本地文件流（供 /stream 路由） */
  streamPath(relPath: string): { abs: string; size: number } | null {
    const cfg = loadConfig();
    const root = path.resolve(cfg.musicDir);
    const abs = path.resolve(root, relPath);
    // 防目录穿越：解析后必须仍在音乐库根目录内
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(abs)) return null;
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { abs, size: st.size };
  }
}
