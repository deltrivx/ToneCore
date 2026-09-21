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
  /** 是否写入歌词（.lrc 同名文件） */
  writeLyrics: boolean;
  /** 下载并发（严格串行防风控） */
  downloadConcurrency: number;
  /** 两个下载之间的间隔(ms) */
  downloadIntervalMs: number;
  /** 平台优先级 */
  platforms: string[];
  /** 音源脚本目录 */
  sourcesDir: string;
  /** 日志级别 */
  logLevel: string;
}

const DEFAULTS: ToneCoreCfg = {
  port: 8090,
  musicDir: '/music',
  dataDir: '/data',
  autoFetch: true,
  quality: 'flac',
  pathTemplate: '{artist}/{album}/{title}',
  embedMetadata: true,
  writeLyrics: true,
  downloadConcurrency: 1,
  downloadIntervalMs: 3000,
  platforms: ['kw', 'kg', 'tx', 'wy', 'mg'],
  sourcesDir: '',
  logLevel: 'info',
};

/**
 * 容器模板（docker/tonecore.xml）里暴露的每一个环境变量都必须在这里接通。
 *
 * 这里刻意写成显式映射而不是遍历 process.env —— 目的是让「模板里有什么变量」
 * 与「代码里读什么变量」一一可对照，避免再出现「界面上改了不生效」的问题。
 * 新增模板变量时，同步在此加一行。
 */
const ENV_BOOL = (v: string | undefined): boolean | undefined => {
  if (v === undefined || v === '') return undefined;
  return !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase());
};

const ENV_NUM = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** 这些值不接受 URL 形式的垃圾输入 */
const QUALITY_WHITELIST = ['master', 'flac24bit', 'flac', '320k', '128k'];

/** 音质别名归一：界面上写「无损」也能认 */
function normalizeQuality(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (QUALITY_WHITELIST.includes(t)) return t;
  const alias: Record<string, string> = {
    '无损': 'flac', 'sq': 'flac', 'flac16bit': 'flac',
    '母带': 'master', 'hires': 'flac24bit', 'hi-res': 'flac24bit', '24bit': 'flac24bit',
    '320': '320k', 'hq': '320k', '高品': '320k',
    '128': '128k', '标准': '128k',
  };
  return alias[t];
}

/** 从环境变量读取覆盖项（仅返回显式设置的项） */
function envOverrides(): Partial<ToneCoreCfg> {
  const e = process.env;
  const out: Partial<ToneCoreCfg> = {};

  const port = ENV_NUM(e.PORT);
  if (port !== undefined) out.port = port;

  if (e.MUSIC_DIR) out.musicDir = e.MUSIC_DIR;
  if (e.DATA_DIR) out.dataDir = e.DATA_DIR;

  const q = normalizeQuality(e.QUALITY);
  if (q) out.quality = q;

  const autoFetch = ENV_BOOL(e.AUTO_FETCH);
  if (autoFetch !== undefined) out.autoFetch = autoFetch;

  const embed = ENV_BOOL(e.EMBED_METADATA);
  if (embed !== undefined) out.embedMetadata = embed;

  const lyrics = ENV_BOOL(e.WRITE_LYRICS);
  if (lyrics !== undefined) out.writeLyrics = lyrics;

  const conc = ENV_NUM(e.DOWNLOAD_CONCURRENCY);
  if (conc !== undefined) out.downloadConcurrency = Math.min(Math.max(1, Math.floor(conc)), 8);

  const interval = ENV_NUM(e.DOWNLOAD_INTERVAL_MS);
  if (interval !== undefined) out.downloadIntervalMs = Math.max(0, interval);

  if (e.PATH_TEMPLATE) out.pathTemplate = e.PATH_TEMPLATE;

  if (e.PLATFORMS) {
    const list = e.PLATFORMS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (list.length) out.platforms = list;
  }

  if (e.LOG_LEVEL) out.logLevel = e.LOG_LEVEL;

  return out;
}

let cached: ToneCoreCfg | null = null;

export function configPath(): string {
  return path.join(process.env.DATA_DIR || DEFAULTS.dataDir, 'config.yaml');
}

/**
 * 读取配置。优先级：环境变量 > config.yaml > 内置默认值。
 *
 * 环境变量优先的原因：容器模板 / compose 是运维的「声明面」，
 * 在 Unraid 上改模板就应当立刻生效，不应被容器内遗留的 config.yaml 覆盖掉。
 */
export function loadConfig(): ToneCoreCfg {
  if (cached) return cached;
  const p = configPath();
  let user: Partial<ToneCoreCfg> = {};
  if (fs.existsSync(p)) {
    try {
      user = YAML.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch { /* 配置损坏时用默认值 */ }
  }
  const merged: ToneCoreCfg = { ...DEFAULTS, ...user, ...envOverrides() };

  // 兜底归一，防止 config.yaml 被手工写坏
  merged.quality = normalizeQuality(merged.quality) ?? DEFAULTS.quality;
  merged.downloadConcurrency = Math.min(Math.max(1, Math.floor(Number(merged.downloadConcurrency) || 1)), 8);
  merged.downloadIntervalMs = Math.max(0, Number(merged.downloadIntervalMs) || 0);
  merged.pathTemplate = merged.pathTemplate || DEFAULTS.pathTemplate;
  merged.sourcesDir = merged.sourcesDir || path.join(merged.dataDir, 'sources');

  cached = merged;
  return cached;
}

/**
 * 保存配置。
 *
 * 注意：环境变量仍然优先于落盘值。若某个字段被环境变量锁定，保存后
 * 该字段的实际生效值不会变 —— 用 lockedByEnv() 把这件事告诉界面，
 * 避免用户「改了没反应」却找不到原因。
 */
export function saveConfig(cfg: Partial<ToneCoreCfg>): ToneCoreCfg {
  const cur = loadConfig();
  const next = { ...cur, ...cfg };
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, YAML.stringify(next), 'utf8');

  // 重新走一遍合并（保持环境变量优先），并刷新缓存
  cached = null;
  return loadConfig();
}

/** 哪些字段被环境变量锁定（供界面提示） */
export function lockedByEnv(): string[] {
  const e = process.env;
  const locked: string[] = [];
  if (e.PORT) locked.push('port');
  if (e.MUSIC_DIR) locked.push('musicDir');
  if (e.DATA_DIR) locked.push('dataDir');
  if (e.QUALITY) locked.push('quality');
  if (e.AUTO_FETCH) locked.push('autoFetch');
  if (e.EMBED_METADATA) locked.push('embedMetadata');
  if (e.WRITE_LYRICS) locked.push('writeLyrics');
  if (e.DOWNLOAD_CONCURRENCY) locked.push('downloadConcurrency');
  if (e.DOWNLOAD_INTERVAL_MS) locked.push('downloadIntervalMs');
  if (e.PATH_TEMPLATE) locked.push('pathTemplate');
  if (e.PLATFORMS) locked.push('platforms');
  if (e.LOG_LEVEL) locked.push('logLevel');
  return locked;
}

/** 确保运行期目录存在 */
export function ensureDirs(cfg: ToneCoreCfg) {
  for (const d of [cfg.musicDir, cfg.dataDir, cfg.sourcesDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
