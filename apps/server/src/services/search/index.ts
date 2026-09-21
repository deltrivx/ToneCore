import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import type { Song } from '../source/types.js';
import { searchKw } from './platforms/kw.js';
import { searchTx } from './platforms/tx.js';
import { searchWy } from './platforms/wy.js';
import { searchMg } from './platforms/mg.js';
import { searchKg } from './platforms/kg.js';

export type SearchFn = (keyword: string, page: number, limit: number) => Promise<Song[]>;

/**
 * 平台搜索层（宿主自研）。
 *
 * 为什么自研：洛雪音源脚本只提供「取直链」能力（action=musicUrl），
 * 搜索必须由宿主实现 —— 这也是 LXServer / lxmusic 等项目的通行做法。
 */
const PLATFORM_SEARCH: Record<string, SearchFn> = {
  kw: searchKw,
  tx: searchTx,
  wy: searchWy,
  mg: searchMg,
  kg: searchKg,
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
