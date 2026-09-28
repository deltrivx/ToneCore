/**
 * 系统媒体控件（Media Session）。
 *
 * 没有这一层，锁屏 / 通知栏 / 耳机线控只会显示浏览器给的页面标题
 * （实测就是「ToneCore · 音乐中枢」）：没有专辑图、没有歌名歌手、也没有播放控制。
 * 想让手机把它当成一个正经音乐页面，就必须通过 navigator.mediaSession 主动上报。
 *
 * 三块内容：
 *   1) metadata —— 标题 / 歌手 / 专辑 / 封面，锁屏上直接可见
 *   2) playbackState —— 锁屏上的播放/暂停按钮状态是否同步
 *   3) action handlers —— 锁屏与耳机线控的上一首/下一首/播放/暂停
 *
 * ⚠️ 封面地址必须是**绝对 URL**：系统媒体控件不在页面上下文里取资源，
 * 传 `/cover/xxx.png` 这种相对路径会拿不到图（表现为锁屏没有专辑图）。
 */

const NOOP = () => {};

/** 把可能是相对路径的地址补全成绝对 URL */
function toAbsolute(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return '';
  }
}

export function useMediaSession({ getTrack, getCover, getPlaying, getDuration, getPosition, handlers = {} }) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    // 不支持的环境直接空转，不能因为锁屏控件把播放逻辑拖挂
    return { update: NOOP, setPosition: NOOP, dispose: NOOP };
  }

  const ms = navigator.mediaSession;

  // 系统控件只认标准化的几个 action，缺了就在锁屏上不显示对应按钮
  const actions = [
    ['play', handlers.play],
    ['pause', handlers.pause],
    ['previoustrack', handlers.prev],
    ['nexttrack', handlers.next],
    ['seekbackward', handlers.seekBackward],
    ['seekforward', handlers.seekForward],
  ];
  for (const [name, fn] of actions) {
    if (!fn) continue;
    try {
      ms.setActionHandler(name, fn);
    } catch {
      /* 个别浏览器不支持某个 action，忽略即可 */
    }
  }

  function setPosition() {
    const dur = Number(getDuration?.()) || 0;
    if (!dur || !Number.isFinite(dur)) return;
    try {
      ms.setPositionState({
        duration: dur,
        position: Math.max(0, Math.min(dur, Number(getPosition?.()) || 0)),
      });
    } catch {
      /* 部分浏览器会在 duration 为 NaN 时抛错，忽略 */
    }
  }

  function update() {
    const t = getTrack?.();
    if (!t) {
      try {
        ms.metadata = null;
        ms.playbackState = 'none';
      } catch { /* 忽略 */ }
      return;
    }

    try {
      // artwork 给多个尺寸：系统按自己的需要挑，只给一张可能不显示
      const src = toAbsolute(getCover?.());
      // ⚠️ type 必须按真实扩展名给：此前一律写 image/png，
      // 而曲库里封面绝大多数是 .jpg —— 系统控件会拒掉 MIME 不匹配的艺术图，
      // 表现就是「锁屏没有专辑图」。
      const ext = (src.split('?')[0].split('.').pop() || '').toLowerCase();
      const type = ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : 'image/jpeg';
      ms.metadata = new window.MediaMetadata({
        title: t.title || '未知歌曲',
        artist: t.artist || '未知歌手',
        album: t.album || '',
        artwork: src
          ? [96, 128, 192, 256, 384, 512].map((size) => ({
              src,
              sizes: `${size}x${size}`,
              type,
            }))
          : [],
      });
    } catch {
      /* MediaMetadata 构造失败不影响播放 */
    }

    try {
      ms.playbackState = getPlaying?.() ? 'playing' : 'paused';
    } catch { /* 忽略 */ }

    setPosition();
  }

  function dispose() {
    for (const [name] of actions) {
      try { ms.setActionHandler(name, null); } catch { /* 忽略 */ }
    }
  }

  return { update, setPosition, dispose };
}
