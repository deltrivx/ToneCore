import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import {
  fetchConversations, fetchDevices, playUrl, tts,
  type MinaConfig,
} from './protocol.js';

export interface SpeakerDevice {
  id: string;
  name: string;
  online: boolean;
  hardware?: string;
}

export interface SpeakerConfig extends Partial<MinaConfig> {
  monitorEnabled: boolean;
  deviceIds: string[];
  /** 轮询间隔（秒） */
  pollInterval: number;
  /** 唤醒词前缀（用于识别点歌指令） */
  wakeWords: string[];
}

const DEFAULT_CFG: SpeakerConfig = {
  monitorEnabled: false,
  deviceIds: [],
  pollInterval: 1,
  wakeWords: ['播放', '放一首', '来一首', '我想听', '放首'],
};

/** 点歌指令解析结果 */
export interface ParsedCommand {
  action: 'play' | 'next' | 'prev' | 'pause' | 'stop' | 'volume' | 'unknown';
  keyword?: string;
  artist?: string;
  volume?: number;
}

/**
 * 从自然语言里解析点歌意图（轻量规则 + 歌手识别）。
 * 例："播放周杰伦的晴天" → { action:'play', keyword:'晴天', artist:'周杰伦' }
 */
export function parseVoiceCommand(text: string): ParsedCommand {
  const raw = text.trim().replace(/^小爱同学[，,、\s]*/, '');

  if (/^(下一首|下一个|切歌|next)$/.test(raw)) return { action: 'next' };
  if (/^(上一首|上一个|prev)$/.test(raw)) return { action: 'prev' };
  if (/^(暂停|继续|恢复)$/.test(raw)) return { action: 'pause' };
  if (/^(停止|别放了|关掉|关机)$/.test(raw)) return { action: 'stop' };

  const vol = raw.match(/音量(?:调到|设为|到)?\s*(\d+)/);
  if (vol) return { action: 'volume', volume: Number(vol[1]) };

  // 点歌：剥掉前缀
  let body = raw.replace(/^(播放|放一首|放首|来一首|来首|我想听|想听|听一首|听)\s*/, '').trim();
  if (!body || body === raw) {
    // 没匹配到动词的，尝试整体当歌名
    if (raw.length < 30) body = raw;
    else return { action: 'unknown' };
  }

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
  return { action: 'play', keyword, artist };
}

/**
 * 小爱音箱服务：设备管理 + 对话轮询 + 推流。
 */
export class SpeakerService {
  private cfg: SpeakerConfig = { ...DEFAULT_CFG };
  private devices: SpeakerDevice[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastTs = 0;
  private onCommand: ((cmd: ParsedCommand, deviceId: string, raw: string) => Promise<void>) | null = null;
  private cfgPath: string;

  constructor() {
    const c = loadConfig();
    this.cfgPath = path.join(c.dataDir, 'speaker.yaml');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.cfgPath)) {
        const YAML = require('yaml');
        this.cfg = { ...DEFAULT_CFG, ...YAML.parse(fs.readFileSync(this.cfgPath, 'utf8')) };
      }
    } catch (e) {
      logger.warn({ err: String(e) }, '音箱配置读取失败');
    }
  }

  private persist() {
    try {
      const YAML = require('yaml');
      fs.writeFileSync(this.cfgPath, YAML.stringify(this.cfg), { mode: 0o600 });
    } catch (e) {
      logger.warn({ err: String(e) }, '音箱配置保存失败');
    }
  }

  get enabled(): boolean { return this.cfg.monitorEnabled && !!this.cfg.serviceToken; }

  get status() {
    return {
      enabled: this.enabled,
      account: this.cfg.userId ? String(this.cfg.userId).replace(/^(\d{3})\d+(\d{2})$/, '$1****$2') : null,
      credentialReady: !!(this.cfg.userId && this.cfg.serviceToken && this.cfg.ssecurity),
      deviceCount: this.devices.length,
      devices: this.devices,
      pollInterval: this.cfg.pollInterval,
    };
  }

  configure(cfg: Partial<SpeakerConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
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
        const records = await fetchConversations(cfg, did, 5, this.lastTs);
        for (const rec of records) {
          const q = String(rec.query ?? rec.question ?? '').trim();
          const ans = String(rec.answer ?? rec.reply ?? '');
          if (!q) continue;
          const ts = Number(rec.time ?? rec.timestamp ?? 0);
          if (ts && ts <= this.lastTs) continue;
          if (ts) this.lastTs = Math.max(this.lastTs, ts);

          // 只处理"小爱没听懂/走会员"的指令 —— 即它自己没接住点歌
          const parsed = parseVoiceCommand(q);
          if (parsed.action === 'unknown') continue;
          logger.info({ device: did, q, ans: ans.slice(0, 40), parsed }, '捕获语音指令');
          await this.onCommand(parsed, did, q);
        }
      } catch (e) {
        logger.debug({ device: did, err: String(e) }, '对话轮询失败');
      }
    }
  }
}

export { parseVoiceCommand as _parse };
