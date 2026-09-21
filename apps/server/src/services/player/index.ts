import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import type { SourceEngine, Song } from '../source/index.js';
import type { Library } from '../library/index.js';

/**
 * 播放器状态机（对应 SongLoft 的 player 契约）。
 *
 * 设计要点：
 *   1. **服务端持队列**，而不是把队列丢给前端。<audio> 元素没有播放列表概念，
 *      一旦页面刷新 / 换设备，队列就没了。服务端持状态才能做到「刷新后接着放」。
 *   2. **取链时机**：入队时只做搜索拿元信息，**真正取直链放到播放那一刻**。
 *      原因：直链大多带时效签名，提前取好会在轮到时已经过期。
 *   3. **循环模式**：list（列表）/ single（单曲）/ shuffle（随机）。
 *
 * 前端只负责「渲染 + 调 <audio>」，所有顺序决策都在这里。
 */

export type RepeatMode = 'list' | 'single' | 'shuffle';

export interface QueueItem {
  /** 队列内唯一 ID（前端用 key，避免同歌重复入队时渲染错乱） */
  uid: string;
  title: string;
  artist: string;
  album?: string;
  platform: string;
  songId: string;
  /** 曲库相对路径（本地歌才有） */
  filePath?: string;
  origin: 'local' | 'remote';
  duration?: number;
  coverUrl?: string;
}

export interface PlayerState {
  /** 当前队列 */
  queue: QueueItem[];
  /** 当前播放下标，-1 表示空 */
  index: number;
  playing: boolean;
  repeat: RepeatMode;
  /** 当前曲目**已解析出的**可播地址（前端 <audio> 直接吃） */
  playUrl: string | null;
  /** 当前曲目实际音质（取链后回填） */
  quality: string | null;
  volume: number;
  /** 已播过的历史（用于「上一首」在随机模式下回退） */
  history: number[];
  updatedAt: number;
}

/** 新建队列项时生成 uid */
let uidSeq = 0;
const nextUid = () => `q${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

export class PlayerService {
  private state: PlayerState = {
    queue: [],
    index: -1,
    playing: false,
    repeat: 'list',
    playUrl: null,
    quality: null,
    volume: 80,
    history: [],
    updatedAt: Date.now(),
  };

  constructor(
    private engine: SourceEngine,
    private lib: Library,
  ) {}

  snapshot(): PlayerState {
    return { ...this.state, queue: this.state.queue.map((q) => ({ ...q })) };
  }

  /**
   * 用一组歌曲替换整个队列并定位到 fromIndex。
   * 这是「搜索页点一首歌」和「专辑整张播放」的共同入口。
   */
  async setQueue(songs: QueueItem[], fromIndex = 0): Promise<PlayerState> {
    this.state.queue = songs;
    this.state.index = songs.length ? Math.min(Math.max(0, fromIndex), songs.length - 1) : -1;
    this.state.history = [];
    this.state.playUrl = null;
    await this.resolveCurrent();
    this.state.playing = this.state.playUrl !== null;
    this.touch();
    return this.snapshot();
  }

  /** 追加到队列尾部（「添加到播放列表」） */
  append(songs: QueueItem[]): PlayerState {
    const base = this.state.queue.length;
    this.state.queue.push(...songs.map((s) => ({ ...s, uid: s.uid || nextUid() })));
    // 原本是空队列 → 自动从第一首开始
    if (this.state.index < 0 && base === 0 && this.state.queue.length) {
      this.state.index = 0;
    }
    this.touch();
    void this.resolveCurrent();
    return this.snapshot();
  }

  /** 跳到指定下标并开始播放 */
  async jump(index: number): Promise<PlayerState> {
    if (index < 0 || index >= this.state.queue.length) return this.snapshot();
    if (this.state.index >= 0) this.state.history.push(this.state.index);
    this.state.index = index;
    await this.resolveCurrent();
    this.state.playing = this.state.playUrl !== null;
    this.touch();
    return this.snapshot();
  }

  /**
   * 下一首。
   *
   * 循环模式决定行为：
   *   single  → 原地重播（前端靠 audio.currentTime=0 实现，这里保持 index 不变）
   *   shuffle → 随机挑一个不等于当前的下标
   *   list    → 顺序 +1，到底回卷到 0（单曲队列时就是重播自己）
   */
  async next(manual = true): Promise<PlayerState> {
    const n = this.state.queue.length;
    if (n === 0) return this.snapshot();

    if (this.state.repeat === 'single' && !manual) {
      // 自动播完触发的单曲循环：原地重播
      await this.resolveCurrent();
      this.touch();
      return this.snapshot();
    }

    let target: number;
    if (this.state.repeat === 'shuffle' && n > 1) {
      do { target = Math.floor(Math.random() * n); } while (target === this.state.index);
    } else {
      target = this.state.index + 1;
      if (target >= n) {
        if (this.state.repeat === 'list') {
          target = 0;               // 列表循环回卷
        } else {
          // 顺序播放到末尾：停在这里，不清空队列（用户可能想重播）
          this.state.playing = false;
          this.touch();
          return this.snapshot();
        }
      }
    }

    return this.jump(target);
  }

  /**
   * 上一首。
   *
   * 优先回退到 history 里真实播过的位置（随机模式下顺序回退是错的）；
   * history 为空时按模式推算，随机模式就再随机一首。
   */
  async prev(): Promise<PlayerState> {
    const n = this.state.queue.length;
    if (n === 0) return this.snapshot();

    const back = this.state.history.pop();
    if (back !== undefined && back >= 0 && back < n) {
      this.state.index = back;
      await this.resolveCurrent();
      this.state.playing = this.state.playUrl !== null;
      this.touch();
      return this.snapshot();
    }

    let target: number;
    if (this.state.repeat === 'shuffle' && n > 1) {
      do { target = Math.floor(Math.random() * n); } while (target === this.state.index);
    } else {
      target = this.state.index - 1 < 0 ? n - 1 : this.state.index - 1;
    }
    return this.jump(target);
  }

  setRepeat(mode: RepeatMode): PlayerState {
    this.state.repeat = mode;
    this.touch();
    return this.snapshot();
  }

  setPlaying(playing: boolean): PlayerState {
    // 没有可播地址时不允许标记为播放中
    this.state.playing = playing && this.state.playUrl !== null;
    this.touch();
    return this.snapshot();
  }

  setVolume(v: number): PlayerState {
    this.state.volume = Math.min(100, Math.max(0, Math.round(v)));
    this.touch();
    return this.snapshot();
  }

  /** 删掉队列里的某一项（按 uid，因为同一首歌可能被重复添加） */
  remove(uid: string): PlayerState {
    const i = this.state.queue.findIndex((q) => q.uid === uid);
    if (i < 0) return this.snapshot();
    this.state.queue.splice(i, 1);

    if (this.state.queue.length === 0) {
      this.state.index = -1;
      this.state.playUrl = null;
    } else if (i < this.state.index) {
      this.state.index--;              // 删的是前面的项，下标左移
    } else if (i === this.state.index) {
      // 删掉的是当前曲目：原地接上后一首（越界则回卷）
      this.state.index = Math.min(this.state.index, this.state.queue.length - 1);
      void this.resolveCurrent();
    }
    this.touch();
    return this.snapshot();
  }

  clear(): PlayerState {
    this.state.queue = [];
    this.state.index = -1;
    this.state.history = [];
    this.state.playUrl = null;
    this.state.playing = false;
    this.touch();
    return this.snapshot();
  }

  /**
   * 为当前曲目解析可播地址。
   *
   * 关键：本地曲库优先。命中本地就直接给 /stream 直链，
   * 不消耗音源额度，也不受上游限流影响。
   */
  private async resolveCurrent(): Promise<void> {
    const cur = this.state.queue[this.state.index];
    if (!cur) {
      this.state.playUrl = null;
      return;
    }

    // 本地曲库二次确认：即使入队时判定为 remote，落库完成后这里也能自动转本地
    if (!cur.filePath) {
      const local = this.lib.find(cur.title, cur.artist);
      if (local) {
        cur.filePath = local.filePath;
        cur.origin = 'local';
        logger.debug({ title: local.title }, '播放时命中本地曲库');
      }
    }

    if (cur.filePath) {
      this.state.playUrl = `/stream/${encodeURIComponent(cur.filePath)}`;
      this.state.quality = 'local';
      return;
    }

    const cfg = loadConfig();
    const song: Song = {
      platform: cur.platform,
      id: cur.songId,
      title: cur.title,
      artist: cur.artist,
      album: cur.album,
    };
    const url = await this.engine.getUrl(song, cfg.quality);
    if (url) {
      this.state.playUrl = `/proxy?url=${encodeURIComponent(url.url)}`;
      this.state.quality = url.quality;
    } else {
      this.state.playUrl = null;
      logger.warn({ title: cur.title, artist: cur.artist, platform: cur.platform }, '播放取链失败');
    }
  }

  private touch() {
    this.state.updatedAt = Date.now();
  }
}
