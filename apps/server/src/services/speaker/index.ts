import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import {
  fetchConversations, fetchDevices, playUrl, tts,
  loginMiAccount, verifyMiLogin,
  playerControl, setVolume, getVolume,
  type MinaConfig,
  type MiLoginResult,
  type PlayerAction,
} from './protocol.js';
import { importFromSongLoft } from './songloft-import.js';

export interface SpeakerDevice {
  id: string;
  name: string;
  online: boolean;
  hardware?: string;
}

export interface SpeakerConfig extends Partial<MinaConfig> {
  /** 小米账号（手机号 / 邮箱 / 小米 ID）—— 用户只需填这一项 + 密码 */
  username?: string;
  /** 账号密码（仅登录阶段使用，落盘权限 600） */
  password?: string;
  monitorEnabled: boolean;
  deviceIds: string[];
  /** 轮询间隔（秒） */
  pollInterval: number;
  /** 唤醒词前缀（用于识别点歌指令） */
  wakeWords: string[];
  /** 登录 token 过期时间戳（毫秒） */
  tokenExpiresAt?: number;

  // ---------- 以下对齐 SongLoft MIoT 插件的可配置项 ----------
  // 只搬「对 ToneCore 有意义」的项。SongLoft 自身架构相关的
  // （server_host / external_search_* / default_cover_id 等）不搬 ——
  // 那些指向 SongLoft 自己的服务与资源，在 ToneCore 里没有对应物。

  /** 语音指令解析（关闭后只推流，不解析点歌意图） */
  voiceCommandEnabled: boolean;
  /** 语音上下文记忆（「上一首 / 下一首」依赖它） */
  voiceMemoryEnabled: boolean;
  voiceMemoryMaxRecords: number;
  scheduledTasksEnabled: boolean;
  timezone: string;

  /** 强制转 MP3（部分老音箱不支持 FLAC） */
  forceMp3: boolean;
  radioForceMp3: boolean;
  /** 音量归一化 */
  volumeNormalize: boolean;
  /** 切歌偏移（秒） */
  songTransitionOffset: number;

  /** 选源策略：parallel=并发 / sequential=顺序 */
  searchPriority: 'parallel' | 'sequential';
  /** 单条指令最多取第几首 */
  maxSongIndex: number;

  indicatorLightEnabled: boolean;
  /** 触屏音箱显示歌词 */
  touchscreenLyricsEnabled: boolean;

  /** 搜索中语音提示 */
  interruptTtsHintEnabled: boolean;
  interruptTtsHintText: string;
  /** 播放前播报 */
  playAnnouncementEnabled: boolean;
  playAnnouncementTemplate: string;
  playAnnouncementWaitMode: 'auto' | 'fixed';
  playAnnouncementDelay: number;
  playAnnouncementScope: 'voice' | 'all';

  /** 智能续播超时（秒） */
  smartResumeTimeout: number;
  debugLogEnabled: boolean;

  /** AI 意图兜底（可选）。aiApiKey 只由用户在界面填写，不从任何外部配置复制。 */
  aiEnabled: boolean;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTimeout: number;
}

/** 账号脱敏：13035699603 -> 130****03 */
function maskAccount(a: string): string {
  if (a.length <= 5) return a;
  return a.replace(/^(\d{3})\d+(\d{2})$/, "$1****$2");
}

const DEFAULT_CFG: SpeakerConfig = {
  monitorEnabled: false,
  deviceIds: [],
  pollInterval: 1,
  wakeWords: ['播放', '放一首', '来一首', '我想听', '放首'],

  voiceCommandEnabled: true,
  voiceMemoryEnabled: true,
  voiceMemoryMaxRecords: 100,
  scheduledTasksEnabled: false,
  timezone: 'Asia/Shanghai',

  forceMp3: false,
  radioForceMp3: false,
  volumeNormalize: false,
  songTransitionOffset: 0,

  searchPriority: 'parallel',
  maxSongIndex: 10000,

  indicatorLightEnabled: true,
  touchscreenLyricsEnabled: false,

  interruptTtsHintEnabled: false,
  interruptTtsHintText: '正在搜索，请稍候',
  playAnnouncementEnabled: false,
  playAnnouncementTemplate: '即将播放{artist}的{song}',
  playAnnouncementWaitMode: 'auto',
  playAnnouncementDelay: 3,
  playAnnouncementScope: 'voice',

  smartResumeTimeout: 30,
  debugLogEnabled: false,

  aiEnabled: false,
  aiApiUrl: '',
  aiApiKey: '',
  aiModel: '',
  aiTimeout: 6,
};

/** 点歌指令解析结果 */
export interface ParsedCommand {
  action: 'play' | 'next' | 'prev' | 'pause' | 'resume' | 'stop' | 'volume' | 'unknown';
  keyword?: string;
  artist?: string;
  /** 绝对音量（0~100），action='volume' 且有明确数字时给出 */
  volume?: number;
  /** 相对音量增量，用于「大声点」「小一点」 */
  volumeDelta?: number;
}

/**
 * 从自然语言里解析点歌意图（轻量规则 + 歌手识别）。
 * 例："播放周杰伦的晴天" → { action:'play', keyword:'晴天', artist:'周杰伦' }
 *
 * 规则刻意保持「宁可漏判、不可误判」：识别不出来就返回 unknown，
 * 上层直接忽略（音箱自己会处理）。误判的代价是抢走音箱的正常播放，
 * 比漏判严重得多。
 */
export function parseVoiceCommand(text: string): ParsedCommand {
  const raw = text.trim().replace(/^小爱同学[，,、\s]*/, '');

  // ---- 播放控制 ----
  // 注意「继续」要单独判，它语义上是 resume 而非 pause
  if (/^(下一首|下一个|切歌|换一首|换一个|换首|跳过|next)$/.test(raw)) return { action: 'next' };
  if (/^(上一首|上一个|前一首|prev)$/.test(raw)) return { action: 'prev' };
  if (/^(继续|继续播放|接着放|恢复播放|接着播)$/.test(raw)) return { action: 'resume' };
  if (/^(暂停|停一下|先停|pause)$/.test(raw)) return { action: 'pause' };
  if (/^(停止|别放了|关掉|关机|别唱了|不听了|stop)$/.test(raw)) return { action: 'stop' };

  // ---- 音量：绝对 ----
  // 兼容 "音量调到50"、"音量50"、"把音量设成 80"、"音量百分之70"
  const volAbs = raw.match(/音量(?:调到|调成|设为|设成|调整到|到|百分之)?\s*(\d{1,3})/);
  if (volAbs) return { action: 'volume', volume: clampVolume(Number(volAbs[1])) };

  // ---- 音量：相对 ----
  // 兼容 "大声点"、"声音大一点"、"小声点"、"音量高一些"
  if (/^(大声|声音大|音量大|响一点|响点)/.test(raw) || /大(一点|一些|声)?点?$/.test(raw)) {
    return { action: 'volume', volumeDelta: 15 };
  }
  if (/^(小声|声音小|音量小|轻一点|轻点)/.test(raw) || /小(一点|一些|声)?点?$/.test(raw)) {
    return { action: 'volume', volumeDelta: -15 };
  }

  // ---- 点歌：剥掉前缀 ----
  let body = raw.replace(/^(播放|放一首|放首|来一首|来首|我想听|想听|听一首|听|点一首|点首|点)\s*/, '').trim();
  if (!body || body === raw) {
    // 没匹配到动词的，尝试整体当歌名
    if (raw.length < 30) body = raw;
    else return { action: 'unknown' };
  }
  if (!body) return { action: 'unknown' };

  // "周杰伦的晴天" / "周杰伦 晴天" / "晴天的周杰伦"
  let artist: string | undefined;
  let keyword = body;
  const m1 = body.match(/^(.+?)的(.+)$/);
  if (m1) {
    const [, a, t] = m1;
    // 通常"歌手的歌名"
    artist = a.trim();
    keyword = t.trim();
  }
  if (!keyword) return { action: 'unknown' };
  return { action: 'play', keyword, artist };
}

/** 音量截断到合法区间 */
function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/**
 * 小爱音箱服务：设备管理 + 对话轮询 + 推流。
 */
export class SpeakerService {
  private cfg: SpeakerConfig = { ...DEFAULT_CFG };
  private devices: SpeakerDevice[] = [];
  private timer: NodeJS.Timeout | null = null;
  /**
   * 每个设备各自记录已处理到的时间戳。
   *
   * 踩坑记录：早期用单个 lastTs 共享给所有设备，导致「A 设备出现一条新指令后，
   * lastTs 被抬高，B 设备同一批里时间戳更早的指令就被静默丢掉了」。
   * 多台音箱同时在线时表现为「只有一台能点歌」，且时好时坏极难复现。
   */
  private lastTsByDevice = new Map<string, number>();
  private onCommand: ((cmd: ParsedCommand, deviceId: string, raw: string) => Promise<void>) | null = null;
  private cfgPath: string;

  constructor() {
    const c = loadConfig();
    this.cfgPath = path.join(c.dataDir, 'speaker.yaml');
    this.load();
    this.tryImportFromSongLoft();
  }

  /**
   * 首次启动且本地无凭据时，尝试从 SongLoft 导入已登录的小米凭据。
   * 自行登录小米需要精确复刻签名，风控下易踩 code=10001；
   * 复用 SongLoft 的登录态最稳。导入成功后立即拉设备并启动监听。
   */
  private tryImportFromSongLoft() {
    if (this.cfg.serviceToken && this.cfg.ssecurity && this.cfg.userId) return;
    const cred = importFromSongLoft(process.env.SONGLOFT_DATA_DIR || '/songloft_data');
    if (!cred) return;
    this.cfg = {
      ...this.cfg,
      username: this.cfg.username || cred.username,
      userId: cred.userId,
      serviceToken: cred.serviceToken,
      ssecurity: cred.ssecurity,
      tokenExpiresAt: cred.expiresAt,
      deviceIds: this.cfg.deviceIds.length ? this.cfg.deviceIds : cred.deviceIds,
    };
    this.persist();
    void this.refreshDevices().catch(() => undefined);
    if (this.cfg.monitorEnabled) this.startMonitor();
  }

  private load() {
    try {
      if (fs.existsSync(this.cfgPath)) {
        this.cfg = { ...DEFAULT_CFG, ...YAML.parse(fs.readFileSync(this.cfgPath, 'utf8')) };
      }
    } catch (e) {
      logger.warn({ err: String(e) }, '音箱配置读取失败');
    }
  }

  private persist() {
    try {
      fs.writeFileSync(this.cfgPath, YAML.stringify(this.cfg), { mode: 0o600 });
    } catch (e) {
      logger.warn({ err: String(e) }, '音箱配置保存失败');
    }
  }

  get enabled(): boolean { return this.cfg.monitorEnabled && !!this.cfg.serviceToken; }

  get loggedIn(): boolean {
    return !!(this.cfg.userId && this.cfg.serviceToken && this.cfg.ssecurity);
  }

  get status() {
    return {
      enabled: this.enabled,
      loggedIn: this.loggedIn,
      account: this.cfg.username ? maskAccount(this.cfg.username) : null,
      userId: this.cfg.userId ?? null,
      credentialReady: this.loggedIn,
      deviceCount: this.devices.length,
      devices: this.devices,
      pollInterval: this.cfg.pollInterval,
      wakeWords: this.cfg.wakeWords,
      deviceIds: this.cfg.deviceIds,
      tokenExpiresAt: this.cfg.tokenExpiresAt ?? null,

      // 对齐 SongLoft MIoT 的可配置项（前端音箱设置区直接渲染）
      voiceCommandEnabled: this.cfg.voiceCommandEnabled,
      voiceMemoryEnabled: this.cfg.voiceMemoryEnabled,
      voiceMemoryMaxRecords: this.cfg.voiceMemoryMaxRecords,
      scheduledTasksEnabled: this.cfg.scheduledTasksEnabled,
      timezone: this.cfg.timezone,

      forceMp3: this.cfg.forceMp3,
      radioForceMp3: this.cfg.radioForceMp3,
      volumeNormalize: this.cfg.volumeNormalize,
      songTransitionOffset: this.cfg.songTransitionOffset,

      searchPriority: this.cfg.searchPriority,
      maxSongIndex: this.cfg.maxSongIndex,

      indicatorLightEnabled: this.cfg.indicatorLightEnabled,
      touchscreenLyricsEnabled: this.cfg.touchscreenLyricsEnabled,

      interruptTtsHintEnabled: this.cfg.interruptTtsHintEnabled,
      interruptTtsHintText: this.cfg.interruptTtsHintText,
      playAnnouncementEnabled: this.cfg.playAnnouncementEnabled,
      playAnnouncementTemplate: this.cfg.playAnnouncementTemplate,
      playAnnouncementWaitMode: this.cfg.playAnnouncementWaitMode,
      playAnnouncementDelay: this.cfg.playAnnouncementDelay,
      playAnnouncementScope: this.cfg.playAnnouncementScope,

      smartResumeTimeout: this.cfg.smartResumeTimeout,
      debugLogEnabled: this.cfg.debugLogEnabled,

      aiEnabled: this.cfg.aiEnabled,
      aiApiUrl: this.cfg.aiApiUrl,
      // 只回传「有没有配」和尾部 4 位，不回传完整密钥
      aiApiKeySet: !!this.cfg.aiApiKey,
      aiApiKeyHint: this.cfg.aiApiKey ? '…' + this.cfg.aiApiKey.slice(-4) : '',
      aiModel: this.cfg.aiModel,
      aiTimeout: this.cfg.aiTimeout,
    };
  }

  /** 账号密码登录（对齐 SongLoft MIoT 契约：只需 username + password） */
  async login(username: string, password: string): Promise<MiLoginResult> {
    const r = await loginMiAccount({ username, password });
    if (r.ok && r.mina) {
      this.cfg = {
        ...this.cfg,
        username, password,
        userId: r.mina.userId,
        serviceToken: r.mina.serviceToken,
        ssecurity: r.mina.ssecurity,
        tokenExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
      };
      this.persist();
      logger.info({ account: maskAccount(username) }, '音箱账号登录成功');
      await this.refreshDevices();
      if (this.cfg.monitorEnabled) this.startMonitor();
      return r;
    }
    if (r.needVerify) {
      logger.info({ account: maskAccount(username) }, '音箱登录需要验证码');
      return r;
    }
    logger.warn({ err: r.error }, '音箱账号登录失败');
    return r;
  }

  /** 提交短信 / 邮箱验证码完成登录 */
  async verify(username: string, password: string, code: string, sign: string): Promise<MiLoginResult> {
    const r = await verifyMiLogin({ username, password }, code, sign);
    if (r.ok && r.mina) {
      this.cfg = {
        ...this.cfg,
        username, password,
        userId: r.mina.userId,
        serviceToken: r.mina.serviceToken,
        ssecurity: r.mina.ssecurity,
        tokenExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
      };
      this.persist();
      await this.refreshDevices();
      if (this.cfg.monitorEnabled) this.startMonitor();
    }
    return r;
  }

  /** 退出登录：清空凭据，保留监听偏好 */
  logout(): void {
    this.stopMonitor();
    this.cfg = {
      ...this.cfg,
      userId: undefined,
      serviceToken: undefined,
      ssecurity: undefined,
      tokenExpiresAt: undefined,
      password: undefined,
    };
    this.devices = [];
    this.persist();
    logger.info('音箱账号已退出');
  }

  /**
   * 更新音箱配置。
   *
   * 注意 `aiApiKey`：status 只回传脱敏提示（aiApiKeySet / aiApiKeyHint），
   * 前端表单若把整个 status 原样回传，会把 '…ca0f' 这种提示串写进真实密钥位，
   * 直接把 AI 兜底打死。这里做两件事：
   *   1) 丢弃前端传来的 aiApiKeyHint / aiApiKeySet（它们不是可写字段）；
   *   2) 空串 / 纯提示串不覆盖已存密钥 —— 想换密钥就填一个新的完整值。
   */
  configure(cfg: Partial<SpeakerConfig> & { aiApiKeyHint?: string; aiApiKeySet?: boolean }) {
    const incoming = { ...cfg };
    delete incoming.aiApiKeyHint;
    delete incoming.aiApiKeySet;

    if (incoming.aiApiKey !== undefined) {
      const v = String(incoming.aiApiKey || '').trim();
      // 形如 '…xxxx' 的是回显提示，不是真密钥
      const isHint = v === '' || (v.startsWith('…') && v.length <= 8);
      if (isHint) delete incoming.aiApiKey;
    }

    this.cfg = { ...this.cfg, ...incoming };
    this.persist();
    logger.info({ enabled: this.cfg.monitorEnabled, devices: this.cfg.deviceIds.length }, '音箱配置已更新');
    if (this.cfg.monitorEnabled) this.startMonitor();
    else this.stopMonitor();
  }

  /** 注册点歌回调（由 orchestrator 注入） */
  onCommandHandler(fn: (cmd: ParsedCommand, deviceId: string, raw: string) => Promise<void>) {
    this.onCommand = fn;
  }

  /** 拉取账号下设备列表 */
  async refreshDevices(): Promise<SpeakerDevice[]> {
    const cfg = this.minaCfg();
    if (!cfg) return [];
    try {
      const list = await fetchDevices(cfg);
      this.devices = (list || []).map((d: any) => ({
        id: String(d.deviceID ?? d.did ?? ''),
        name: String(d.name ?? '小爱音箱'),
        online: d.presence === 'online' || d.isOnline === true,
        hardware: d.hardware,
      })).filter((d) => d.id);
      logger.info({ count: this.devices.length }, '设备列表已刷新');
    } catch (e) {
      logger.warn({ err: String(e) }, '设备列表拉取失败');
    }
    return this.devices;
  }

  private minaCfg(): MinaConfig | null {
    if (!this.cfg.userId || !this.cfg.serviceToken || !this.cfg.ssecurity) return null;
    return { userId: this.cfg.userId, serviceToken: this.cfg.serviceToken, ssecurity: this.cfg.ssecurity };
  }

  /** 推送音频直链到音箱 */
  async play(deviceId: string, audioUrl: string): Promise<boolean> {
    const cfg = this.minaCfg();
    if (!cfg) { logger.warn('音箱凭据未配置'); return false; }
    const id = deviceId || this.cfg.deviceIds[0] || this.devices[0]?.id;
    if (!id) { logger.warn('无可用设备'); return false; }
    const ok = await playUrl(cfg, id, audioUrl);
    logger.info({ deviceId: id, url: audioUrl.slice(0, 70), ok }, '推送播放');
    return ok;
  }

  /** 语音播报（点歌失败提示等） */
  async say(deviceId: string, text: string): Promise<boolean> {
    const cfg = this.minaCfg();
    if (!cfg) return false;
    const id = deviceId || this.cfg.deviceIds[0] || this.devices[0]?.id;
    if (!id) return false;
    return tts(cfg, id, text);
  }

  /** 启动对话轮询 */
  startMonitor(): void {
    if (!this.enabled) { logger.warn('音箱服务未启用或凭据缺失'); return; }
    if (this.timer) return;
    const interval = Math.max(1, this.cfg.pollInterval) * 1000;
    logger.info({ interval, devices: this.cfg.deviceIds.length }, '对话监听已启动');
    this.timer = setInterval(() => { void this.pollOnce(); }, interval);
    void this.pollOnce();
  }

  stopMonitor(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    logger.info('对话监听已停止');
  }

  /** 单次轮询：拉取新对话 → 解析 → 回调 */
  private async pollOnce(): Promise<void> {
    const cfg = this.minaCfg();
    if (!cfg || !this.onCommand) return;
    const targets = this.cfg.deviceIds.length ? this.cfg.deviceIds : this.devices.map((d) => d.id);
    for (const did of targets) {
      try {
        const since = this.lastTsByDevice.get(did) ?? 0;
        const records = await fetchConversations(cfg, did, 5, since);
        for (const rec of records) {
          const q = String(rec.query ?? rec.question ?? '').trim();
          const ans = String(rec.answer ?? rec.reply ?? '');
          if (!q) continue;
          const ts = Number(rec.time ?? rec.timestamp ?? 0);
          if (ts && ts <= since) continue;

          // 先推进游标再回调：回调可能抛错，不能让同一条指令反复触发
          if (ts) this.lastTsByDevice.set(did, Math.max(since, ts));

          // 只处理"小爱没听懂/走会员"的指令 —— 即它自己没接住点歌
          const parsed = parseVoiceCommand(q);
          if (parsed.action === 'unknown') continue;
          logger.info({ device: did, q, ans: ans.slice(0, 40), parsed }, '捕获语音指令');
          try {
            await this.onCommand(parsed, did, q);
          } catch (e) {
            // 单条指令失败不能中断整轮轮询，否则后面的设备永远轮不到
            logger.warn({ device: did, q, err: String(e).slice(0, 200) }, '指令处理失败');
          }
        }
      } catch (e) {
        logger.debug({ device: did, err: String(e) }, '对话轮询失败');
      }
    }
  }

  // ---------- 播放控制（供 orchestrator 的语音指令分支调用） ----------

  /**
   * 下发播放控制。返回 true 表示指令已送达并被音箱接收。
   *
   * 为什么加 try/catch 而不是直接让异常冒到 orchestrator：
   * 这些是「尽力而为」的用户体验动作（喊了下一首），失败也不该影响
   * 点歌主链路，更不该带崩轮询循环。失败只记日志 + 返回 false。
   */
  async control(deviceId: string, action: PlayerAction): Promise<boolean> {
    const cfg = this.minaCfg();
    if (!cfg) { logger.debug('音箱凭据未配置，跳过播放控制'); return false; }
    const id = this.resolveDeviceId(deviceId);
    if (!id) { logger.debug('无可用设备，跳过播放控制'); return false; }
    try {
      return await playerControl(cfg, id, action);
    } catch (e) {
      logger.warn({ device: id, action, err: String(e).slice(0, 150) }, '播放控制失败');
      return false;
    }
  }

  /** 设置音量（0~100，越界自动截断） */
  async setVolume(deviceId: string, volume: number): Promise<boolean> {
    const cfg = this.minaCfg();
    if (!cfg) return false;
    const id = this.resolveDeviceId(deviceId);
    if (!id) return false;
    try {
      return await setVolume(cfg, id, volume);
    } catch (e) {
      logger.warn({ device: id, volume, err: String(e).slice(0, 150) }, '音量设置失败');
      return false;
    }
  }

  /** 相对调节音量（用于「大声点」「小一点」这类无数字指令） */
  async nudgeVolume(deviceId: string, delta: number): Promise<boolean> {
    const cfg = this.minaCfg();
    if (!cfg) return false;
    const id = this.resolveDeviceId(deviceId);
    if (!id) return false;
    try {
      const cur = (await getVolume(cfg, id)) ?? 50;   // 读不到就按中间值推
      return await setVolume(cfg, id, cur + delta);
    } catch (e) {
      logger.warn({ device: id, delta, err: String(e).slice(0, 150) }, '音量相对调节失败');
      return false;
    }
  }

  /** 设备 ID 兜底：显式指定 → 配置首选 → 第一台 */
  private resolveDeviceId(deviceId: string): string {
    return deviceId || this.cfg.deviceIds[0] || this.devices[0]?.id || '';
  }
}

export { parseVoiceCommand as _parse };
