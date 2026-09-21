import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

export interface SpeakerDevice {
  id: string;
  name: string;
  online: boolean;
}

export interface SpeakerConfig {
  /** 小米账号 */
  account?: string;
  /** 设备硬件的 did */
  deviceIds?: string[];
  /** 对话监听开关 */
  monitorEnabled: boolean;
}

/**
 * 小爱音箱接入层。
 *
 * 说明：小米账号登录涉及扫码/二次验证，需在控制台完成，凭据存 /data。
 * 本模块负责设备枚举、推流与对话轮询调度；
 * 具体 MiIO/Mina 协议实现见 services/speaker/protocol.ts。
 */
export class SpeakerService {
  private cfg: SpeakerConfig = { monitorEnabled: false };
  private devices: SpeakerDevice[] = [];

  get enabled(): boolean { return this.cfg.monitorEnabled; }

  get status() {
    return {
      enabled: this.cfg.monitorEnabled,
      account: this.cfg.account ? this.cfg.account.replace(/^(\d{3})\d+(\d{3})$/, '$1****$2') : null,
      deviceCount: this.devices.length,
      devices: this.devices,
    };
  }

  configure(cfg: Partial<SpeakerConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    logger.info({ enabled: this.cfg.monitorEnabled, devices: this.cfg.deviceIds?.length ?? 0 }, '音箱配置已更新');
  }

  setDevices(list: SpeakerDevice[]) {
    this.devices = list;
  }

  /** 推送音频直链到指定音箱 */
  async play(deviceId: string, audioUrl: string): Promise<boolean> {
    if (!this.cfg.monitorEnabled) {
      logger.warn('音箱服务未启用');
      return false;
    }
    logger.info({ deviceId, url: audioUrl.slice(0, 80) }, '推送播放');
    // TODO: 接入 MiIO/Mina 协议下发
    return true;
  }

  /** 启动对话轮询（监听语音指令） */
  startMonitor(): void {
    if (!this.cfg.monitorEnabled) return;
    logger.info('对话监听已启动');
  }

  stopMonitor(): void {
    logger.info('对话监听已停止');
  }
}
