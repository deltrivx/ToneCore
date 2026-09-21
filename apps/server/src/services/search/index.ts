import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import type { Song } from '../source/types.js';
import { searchKw } from './platforms/kw.js';
import { searchTx } from './platforms/tx.js';
import { searchWy } from './platforms/wy.js';

export type SearchFn = (keyword: string, page: number, limit: number) => Promise<Song[]>;

/**
 * 平台搜索层（宿主自研）。
 *
 * 为什么自研：洛雪音源脚本只提供「取直链」能力（action=musicUrl），
 * 搜索必须由宿主实现 —— 这也是 LXServer / lxmusic 等项目的通行做法。
 *
 * 已下线平台（实测 2026-09-22）：
 *   ❌ mg（咪咕）：music.migu.cn/v3/api/search/song 已改版，返回 HTML 而非 JSON
 *   ❌ kg（酷狗）：mobilecdn.kugou.com 证书校验失败，无法建连
 * 两者保留实现文件但不再注册；待上游恢复可按需重新挂上。
 */
const PLATFORM_SEARCH: Record<string, SearchFn> = {
  kw: searchKw,
  tx: searchTx,
  wy: searchWy,
};

/** 已下线但保留代码的平台（界面据此说明「为什么看不到」） */
export const RETIRED_PLATFORMS: Record<string, string> = {
  mg: '咪咕搜索接口已改版（返回 HTML 而非 JSON）',
  kg: '酷狗搜索接口 SSL 证书校验失败',
};

export class SearchEngine {
  /** 单平台搜索 */
  async searchPlatform(platform: string, keyword: string, page = 1, limit = 20): Promise<Song[]> {
    const fn = PLATFORM_SEARCH[platform];
    if (!fn) return [];
    try {
      return await fn(keyword, page, limit);
    } catch (e) {
      logger.debug({ platform, keyword, err: String(e).slice(0, 150) }, '平台搜索失败');
      return [];
    }
  }

  /** 全平台并发搜索 */
  async searchAll(keyword: string, platforms?: string[]): Promise<Map<string, Song[]>> {
    const cfg = loadConfig();
    const use = (platforms?.length ? platforms : cfg.platforms).filter((p) => PLATFORM_SEARCH[p]);
    const out = new Map<string, Song[]>();

    await Promise.all(use.map(async (p) => {
      const list = await this.searchPlatform(p, keyword);
      if (list.length) out.set(p, list);
    }));
    return out;
  }

  /** 支持的平台 */
  get platforms(): string[] { return Object.keys(PLATFORM_SEARCH); }
}
