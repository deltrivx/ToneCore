import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger.js';

/**
 * 从 SongLoft 的 miot 插件数据中导入已登录的小米凭据。
 *
 * 背景：小米账号登录签名（_sign / serviceParam）风控很紧，自行实现容易踩
 * code=10001 / 70016。SongLoft 的 miot 插件已经把登录态持久化在
 *   <songloft_data>/jsplugins_data/miot/data/accounts
 * 里（含 micoapi.service_token + ssecurity），可直接复用，避免重复实现签名。
 *
 * 该目录以只读方式挂载到容器 /songloft_data。
 */

export interface ImportedCredential {
  username: string;
  userId: string;
  serviceToken: string;
  ssecurity: string;
  deviceIds: string[];
  /** 凭据过期时间戳（毫秒），来自 SongLoft 的 expires_at */
  expiresAt?: number;
}

/** 候选路径：SongLoft 不同版本 / 部署方式的落盘位置 */
const CANDIDATE_PATHS = [
  'jsplugins_data/miot/data/accounts',
  'data/miot/accounts',
  'auth_tokens',
];

function resolveAccountsFile(root: string): string | null {
  for (const rel of CANDIDATE_PATHS) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** SongLoft 里 accounts 是「JSON 字符串再被 JSON 包一层」，需要剥壳 */
function unwrap(raw: string): any[] {
  let v: any = JSON.parse(raw);
  if (typeof v === 'string') v = JSON.parse(v);
  if (!Array.isArray(v)) v = [v];
  return v;
}

/**
 * 读取 SongLoft 凭据。找不到或解析失败时返回 null（调用方静默降级）。
 */
export function importFromSongLoft(root = '/songloft_data'): ImportedCredential | null {
  try {
    if (!fs.existsSync(root)) return null;
    const file = resolveAccountsFile(root);
    if (!file) {
      logger.debug({ root }, 'SongLoft 凭据文件未找到');
      return null;
    }

    const accounts = unwrap(fs.readFileSync(file, 'utf8'));
    for (const a of accounts) {
      const svc = a?.services?.micoapi;
      const serviceToken = String(svc?.service_token ?? '');
      const ssecurity = String(svc?.ssecurity ?? '');
      const userId = String(a?.user_id ?? '');
      const username = String(a?.account ?? a?.id ?? '');
      if (!serviceToken || !ssecurity || !userId) continue;

      const deviceIds: string[] = Array.isArray(a?.devices)
        ? a.devices.map((d: any) => String(d?.device_id ?? '')).filter(Boolean)
        : [];

      const expiresAt = Number(svc?.expires_at) || undefined;
      logger.info(
        { file, account: username, devices: deviceIds.length },
        '已从 SongLoft 导入音箱凭据',
      );
      return { username, userId, serviceToken, ssecurity, deviceIds, expiresAt };
    }

    logger.warn({ file }, 'SongLoft 凭据文件中没有可用的 micoapi 条目');
    return null;
  } catch (e) {
    logger.warn({ err: String(e) }, '读取 SongLoft 凭据失败');
    return null;
  }
}
