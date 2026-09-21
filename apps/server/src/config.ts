import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface SourceCfg {
  platform: string;          // kw / kg / tx / wy / mg
  priority: number;          // 数字越小优先级越高
}

export interface ToneCoreCfg {
  port: number;
  musicDir: string;
  dataDir: string;
  /** 点播自动落库 */
  autoFetch: boolean;
  /** 目标音质：master / flac24bit / flac / 320k / 128k */
  quality: string;
  /** 落盘路径模板 */
  pathTemplate: string;
  /** 是否嵌入标签/封面 */
  embedMetadata: boolean;
  /** 下载并发（严格串行防风控） */
  downloadConcurrency: number;
  /** 两个下载之间的间隔(ms) */
  downloadIntervalMs: number;
  /** 平台优先级 */
  platforms: string[];
  /** 音源脚本目录 */
  sourcesDir: string;
}

const DEFAULTS: ToneCoreCfg = {
  port: 8090,
  musicDir: '/music',
  dataDir: '/data',
  autoFetch: true,
  quality: 'flac',
  pathTemplate: '{artist}/{album}/{title}',
  embedMetadata: true,
  downloadConcurrency: 1,
  downloadIntervalMs: 3000,
  platforms: ['kw', 'kg', 'tx', 'wy', 'mg'],
  sourcesDir: '',
};

let cached: ToneCoreCfg | null = null;

export function configPath(): string {
  return path.join(process.env.DATA_DIR || DEFAULTS.dataDir, 'config.yaml');
}

export function loadConfig(): ToneCoreCfg {
  if (cached) return cached;
  const p = configPath();
  let user: Partial<ToneCoreCfg> = {};
  if (fs.existsSync(p)) {
    try {
      user = YAML.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch { /* 配置损坏时用默认值 */ }
  }
  cached = {
    ...DEFAULTS,
    ...user,
    port: Number(process.env.PORT || user.port || DEFAULTS.port),
    musicDir: process.env.MUSIC_DIR || user.musicDir || DEFAULTS.musicDir,
    dataDir: process.env.DATA_DIR || user.dataDir || DEFAULTS.dataDir,
  };
  cached.sourcesDir = cached.sourcesDir || path.join(cached.dataDir, 'sources');
  return cached;
}

export function saveConfig(cfg: Partial<ToneCoreCfg>): ToneCoreCfg {
  const cur = loadConfig();
  const next = { ...cur, ...cfg };
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, YAML.stringify(next), 'utf8');
  cached = next;
  return next;
}

/** 确保运行期目录存在 */
export function ensureDirs(cfg: ToneCoreCfg) {
  for (const d of [cfg.musicDir, cfg.dataDir, cfg.sourcesDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
