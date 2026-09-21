import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

export interface ScriptHealth {
  /** 脚本名 */
  name: string;
  /** 成功次数 */
  success: number;
  /** 失败次数 */
  failure: number;
  /** 累计耗时(ms) */
  totalMs: number;
  /** 最近一次成功时间 */
  lastSuccessAt: number;
  /** 最近一次失败时间 */
  lastFailureAt: number;
  /** 连续失败次数（触发熔断） */
  consecutiveFailures: number;
  /** 加载状态：ok=已加载 / failed=加载失败 */
  loadState?: 'ok' | 'failed';
  /** 加载失败原因（供界面直接展示） */
  loadError?: string;
  /** 加载失败时间 */
  loadErrorAt?: number;
  /** 声明的平台（加载成功时写入） */
  platforms?: string[];
}

/**
 * 音源健康度：学 SongLoft 的做法 —— 记录每个脚本的成功率与延迟，
 * 取链时优先用表现好的，连续失败的临时熔断。
 */
export class HealthTracker {
  private map = new Map<string, ScriptHealth>();
  private file: string;
  private dirty = false;

  constructor() {
    const cfg = loadConfig();
    this.file = path.join(cfg.dataDir, 'source-health.json');
    this.load();
    // 每分钟持久化一次
    setInterval(() => this.persist(), 60000).unref?.();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(raw)) {
          this.map.set(k, v as ScriptHealth);
        }
      }
    } catch (e) {
      logger.debug({ err: String(e) }, '健康度数据读取失败');
    }
  }

  persist() {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map), null, 2));
      this.dirty = false;
    } catch (e) {
      logger.debug({ err: String(e) }, '健康度数据保存失败');
    }
  }

  private get(name: string): ScriptHealth {
    let h = this.map.get(name);
    if (!h) {
      h = { name, success: 0, failure: 0, totalMs: 0, lastSuccessAt: 0, lastFailureAt: 0, consecutiveFailures: 0 };
      this.map.set(name, h);
    }
    return h;
  }

  recordSuccess(name: string, ms: number) {
    const h = this.get(name);
    h.success++;
    h.totalMs += ms;
    h.lastSuccessAt = Date.now();
    h.consecutiveFailures = 0;
    this.dirty = true;
  }

  recordFailure(name: string) {
    const h = this.get(name);
    h.failure++;
    h.lastFailureAt = Date.now();
    h.consecutiveFailures++;
    this.dirty = true;
  }

  /** 记录一次加载失败（脚本没起来，界面必须能看到原因） */
  recordLoadFailure(name: string, err: string) {
    const h = this.get(name);
    h.loadState = 'failed';
    h.loadError = err.slice(0, 300);
    h.loadErrorAt = Date.now();
    h.consecutiveFailures = Math.max(h.consecutiveFailures, 0);
    this.dirty = true;
  }

  /** 记录一次加载成功 */
  recordLoaded(name: string, platforms: string[] = []) {
    const h = this.get(name);
    h.loadState = 'ok';
    h.loadError = undefined;
    h.loadErrorAt = undefined;
    h.platforms = platforms;
    this.dirty = true;
  }

  /** 移除记录（脚本被删除时调用） */
  forget(name: string) {
    if (this.map.delete(name)) this.dirty = true;
  }

  /** 是否加载失败 */
  isLoadFailed(name: string): boolean {
    return this.map.get(name)?.loadState === 'failed';
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  /** 记录在案的脚本名（用于清理已删除文件的历史记录） */
  names(): string[] {
    return [...this.map.keys()];
  }

  /**
   * 健康分（越高越好）。
   * 规则：
   *   - 无记录 → 100（给新脚本机会）
   *   - 连续失败 ≥ 3 → 熔断（返回 -1，跳过）
   *   - 否则 = 成功率 × 100 - 平均耗时(ms)/100
   */
  score(name: string): number {
    const h = this.map.get(name);
    if (!h) return 100;
    if (h.consecutiveFailures >= 3) return -1;   // 熔断
    const total = h.success + h.failure;
    if (total === 0) return 100;
    const rate = h.success / total;
    const avgMs = h.success > 0 ? h.totalMs / h.success : 10000;
    return rate * 100 - avgMs / 100;
  }

  snapshot(): ScriptHealth[] {
    return [...this.map.values()].sort((a, b) => {
      const ra = a.success + a.failure > 0 ? a.success / (a.success + a.failure) : 1;
      const rb = b.success + b.failure > 0 ? b.success / (b.success + b.failure) : 1;
      return rb - ra;
    });
  }

  /** 熔断状态 */
  isTripped(name: string): boolean {
    return (this.map.get(name)?.consecutiveFailures ?? 0) >= 3;
  }
}
