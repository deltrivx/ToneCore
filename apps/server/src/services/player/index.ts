import fs from 'node:fs';
import path from 'node:path';
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
  /**
   * 本地曲库封面：library 扫描时从音频内嵌图片抽出、落在 data/covers 下的**文件名**
   * （不是完整 URL）。前端按 /cover/<name> 拼地址。
   *
   * ⚠️ 与 coverUrl（在线音源平台给的完整地址）是两种形态，缺一不可：
   * 归一化时若只保留 coverUrl，本地歌的封面会被整体丢掉，
   * 表现为「底部播放条不显示专辑封面」（全屏页因走了别的取值路径可能仍正常）。
   */
  cover?: string;
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
  /**
   * 当前曲目的播放位置（毫秒）。
   *
   * ⚠️ 这个字段是「划掉页面再回来能接着听」的关键：队列可以只恢复歌单，
   * 但位置不恢复的话续播永远从头开始，看起来就像进度根本没保存。
   * 由前端上报（/api/player/position），随队列一起落盘。
   */
  positionMs: number;
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
    positionMs: 0,
    history: [],
    updatedAt: Date.now(),
  };

  constructor(
    private engine: SourceEngine,
    private lib: Library,
  ) {
    this.restore();
  }

  // ---------- 持久化 ----------
  //
  // 队列此前是纯内存态：服务端一重启（或容器重建）队列就没了，
  // 前端 init() 拿到空队列 → 界面显示「未有曲目播放」。
  // 播放位置同理：不落盘，续播就只能从头开始。

  /** 状态文件路径（与曲库同盘，重建容器不丢） */
  private get stateFile(): string {
    const dir = process.env.DATA_DIR || '/data';
    return path.join(dir, 'player-state.json');
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      // 只存可序列化的部分；playUrl 每次启动重新解析（上游直链会过期）
      const data = {
        queue: this.state.queue,
        index: this.state.index,
        repeat: this.state.repeat,
        volume: this.state.volume,
        positionMs: this.state.positionMs,
        updatedAt: this.state.updatedAt,
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data), { mode: 0o600 });
    } catch (e) {
      // 落盘失败不致命：最多是刷新后回到空队列，不能因此打断播放
      logger.debug({ err: String(e).slice(0, 200) }, '播放状态落盘失败（已忽略）');
    }
  }

  private restore(): void {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      if (!Array.isArray(raw.queue)) return;
      this.state.queue = raw.queue;
      this.state.index = typeof raw.index === 'number' ? raw.index : -1;
      this.state.repeat = raw.repeat || 'list';
      this.state.volume = typeof raw.volume === 'number' ? raw.volume : 80;
      this.state.positionMs = Number(raw.positionMs) || 0;
      // ⚠️ 刻意不恢复 playing：浏览器不允许无交互自动播放，
      // 前端 init() 同样会把 playing 置 false
      this.state.playing = false;
      logger.info(
        { songs: this.state.queue.length, index: this.state.index, positionMs: this.state.positionMs },
        '播放状态已恢复',
      );
      // 恢复后重新解析当前曲目的可播地址（playUrl 不入库，直链会过期）
      if (this.state.index >= 0) void this.resolveCurrent();
    } catch (e) {
      logger.debug({ err: String(e).slice(0, 200) }, '播放状态恢复失败（已忽略）');
    }
  }

  /** 更新播放位置（前端上报） */
  setPosition(ms: number): PlayerState {
    this.state.positionMs = Math.max(0, Math.round(ms) || 0);
    this.touch();
    return this.snapshot();
  }

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

  /**
   * 状态变更后统一入口：更新时间戳 + 落盘。
   *
   * ⚠️ 落盘必须挂在这里而不是散在各处 —— 否则新增一个改状态的入口
   * （历史上就漏过）就会悄悄退化回「内存态」，表现为队列莫名消失。
   */
  private touch() {
    this.state.updatedAt = Date.now();
    this.persist();
  }
}
