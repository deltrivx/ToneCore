import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

/**
 * 熔断后的冷却窗口：超过这么久没再失败，就清掉连续失败计数，给脚本一次探活机会。
 *
 * 为什么必须有这个窗口：熔断一旦触发，脚本就被 `forPlatform()` 过滤掉，
 * 而 consecutiveFailures 只在「成功」时清零 —— 于是脚本再也没有被调用的机会，
 * 计数永远降不下来，形成**永久锁死**。实测正是这个机制让「单脚本隔离测试能出链、
 * 集成环境却永远 0 成功」：早期一次失败潮把脚本冻住，此后再没被选中过。
 */
const TRIP_COOLDOWN_MS = 10 * 60 * 1000;

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

  /**
   * 手动「测试」的结果回写健康度。
   *
   * 为什么必须有这个方法：此前健康度与手动测试是**两套互不相通的账本** ——
   * 健康度只由真实取链（getUrl）累计，手动测试只写 testResults。
   * 于是出现「手动测试通过、界面却显示 0% 不可用」的诡异画面；
   * 更糟的是 forPlatform() 按健康分排序取前几个，那些从没被自动选中的脚本
   * 永远刷不出成功记录，健康度死锁在低分，形成**饥饿选择**。
   *
   * 现在的口径：手动测试成功即视为一次成功的探活 —— 计成功、清熔断，
   * 让脚本重新有机会参与取链；手动测试失败同样计入，但只累加一次。
   */
  recordProbe(name: string, ok: boolean, ms = 0) {
    const h = this.get(name);
    if (ok) {
      h.success++;
      if (ms > 0) { h.totalMs += ms; if (h.success === 1) h.totalMs = ms; }
      h.lastSuccessAt = Date.now();
      // 关键：清掉连续失败，脚本立刻从熔断里放出来重新参与取链
      h.consecutiveFailures = 0;
    } else {
      h.failure++;
      h.lastFailureAt = Date.now();
      h.consecutiveFailures++;
    }
    this.dirty = true;
    this.persist();
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
   * 半开探活：熔断冷却窗口过后清掉连续失败计数，让脚本能被重新选中一次。
   * 只动计数不动成功/失败历史，历史仍用于算成功率，不影响排序公平性。
   */
  private maybeRecover(h: ScriptHealth): void {
    if (h.consecutiveFailures > 0 && Date.now() - (h.lastFailureAt || 0) > TRIP_COOLDOWN_MS) {
      h.consecutiveFailures = 0;
      this.dirty = true;
    }
  }

  /**
   * 健康分（越高越好）。
   * 规则：
   *   - 无记录 → 100（给新脚本机会）
   *   - 连续失败 ≥ 3 → 熔断（返回 -1，跳过）；但冷却窗口过后会探活复出
   *   - 否则 = 成功率 × 100 - 平均耗时(ms)/100
   */
  score(name: string): number {
    const h = this.map.get(name);
    if (!h) return 100;
    this.maybeRecover(h);
    if (h.consecutiveFailures >= 3) return -1;   // 熔断
    const total = h.success + h.failure;
    if (total === 0) return 100;
    const rate = h.success / total;
    // ⚠️ 没有成功记录时不能套用 10000ms 的默认耗时惩罚：
    // 那会让「失败过几次但其实可用」的脚本拿到 0 - 100 = -100 分，
    // 在 forPlatform() 的排序里永久垫底 —— 明明还能用的源再也轮不到。
    // 没有延迟样本就不扣延迟分（SCRIPTS 可以靠 manual test 自己挣回来）。
    if (h.success === 0) return rate * 100;
    const avgMs = h.totalMs / h.success;
    return rate * 100 - avgMs / 100;
  }

  snapshot(): ScriptHealth[] {
    return [...this.map.values()].sort((a, b) => {
      const ra = a.success + a.failure > 0 ? a.success / (a.success + a.failure) : 1;
      const rb = b.success + b.failure > 0 ? b.success / (b.success + b.failure) : 1;
      return rb - ra;
    });
  }

  /** 熔断状态（冷却窗口过后自动探活，不再永久锁死） */
  isTripped(name: string): boolean {
    const h = this.map.get(name);
    if (!h) return false;
    this.maybeRecover(h);
    return h.consecutiveFailures >= 3;
  }
}
