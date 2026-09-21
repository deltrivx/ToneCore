/** 统一歌曲结构（跨平台） */
export interface Song {
  /** 平台标识：kw / kg / tx / wy / mg */
  platform: string;
  /** 平台内唯一 ID */
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** 秒 */
  duration?: number;
  coverUrl?: string;
  /** 可用音质档位 */
  qualities?: string[];
}

export interface SongUrl {
  url: string;
  /** 实际拿到的音质 */
  quality: string;
  /** 哪个音源脚本提供的 */
  source: string;
}

/** 音源脚本（洛雪格式）的适配接口 */
export interface SourceAdapter {
  name: string;
  platforms: string[];
  search(platform: string, keyword: string, page: number): Promise<Song[]>;
  getUrl(platform: string, song: Song, quality: string): Promise<SongUrl | null>;
}
