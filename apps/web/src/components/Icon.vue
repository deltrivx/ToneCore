<script setup>
/**
 * 全站图标：内联 SVG，统一 24x24 视框、stroke 1.75、圆角端点。
 *
 * 为什么不用 emoji：emoji 在不同系统/浏览器上字形、基线、颜色都不一致，
 * 是界面显得「不专业」最主要的原因。这里替换成可控的矢量图标。
 *
 * 用法：<Icon name="play" :size="18" />
 */
import { computed } from 'vue';

const ICONS = {
  // ---------- 导航 ----------
  home: '<path d="M4 10.6 12 4.2l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5h-4V14h-5v6.5h-4A1.5 1.5 0 0 1 4 19z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  music: '<path d="M9 18V6l11-2v11.5"/><circle cx="6" cy="18" r="3"/><circle cx="17.5" cy="15.5" r="3"/>',
  radio: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',

  // ---------- 播放控制 ----------
  play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.22.68l10.5-6.8a.8.8 0 0 0 0-1.36L9.22 4.52A.8.8 0 0 0 8 5.2Z"/>',
  pause: '<path d="M7.5 4.5h3.2v15H7.5zM13.3 4.5h3.2v15h-3.2z"/>',
  prev: '<path d="M18.5 5.5v13a.8.8 0 0 1-1.23.68l-9.5-6.5a.8.8 0 0 1 0-1.36l9.5-6.5a.8.8 0 0 1 1.23.68Z"/><rect x="4.6" y="5" width="2" height="14" rx="1"/>',
  next: '<path d="M5.5 5.5v13a.8.8 0 0 0 1.23.68l9.5-6.5a.8.8 0 0 0 0-1.36l-9.5-6.5A.8.8 0 0 0 5.5 5.5Z"/><rect x="17.4" y="5" width="2" height="14" rx="1"/>',
  repeat: '<path d="m17 2.5 4 4-4 4"/><path d="M3 11.5V9a4 4 0 0 1 4-4h14"/><path d="m7 21.5-4-4 4-4"/><path d="M21 12.5V15a4 4 0 0 1-4 4H3"/>',
  repeat1: '<path d="m17 2.5 4 4-4 4"/><path d="M3 11.5V9a4 4 0 0 1 4-4h14"/><path d="m7 21.5-4-4 4-4"/><path d="M21 12.5V15a4 4 0 0 1-4 4H3"/><path d="M10.6 9.6 12.2 8.6v6"/><path d="M10 15.4h3.4" />',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
  volume: '<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.8a7.5 7.5 0 0 1 0 10.4"/>',
  mute: '<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',

  // ---------- 操作 ----------
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4.5 20h15"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4.5V10H15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  pencil: '<path d="M4.5 19.5h3.5L19.2 8.3a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L4.5 16z"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="m10 8-4 4 4 4"/><path d="M6 12h9"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1"/>',
  more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  heart: '<path d="M12 20.3 4.7 13a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8A4.6 4.6 0 1 1 19.3 13z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 5.8A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4.2"/><path d="M6.3 7.6A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.4-.3 3.5-.7"/><path d="m3 3 18 18"/>',

  // ---------- 方向与视图 ----------
  chevronUp: '<path d="m6 14 6-6 6 6"/>',
  chevronDown: '<path d="m6 10 6 6 6-6"/>',
  chevronLeft: '<path d="m14 6-6 6 6 6"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  expand: '<path d="M8 3.5H5.5A2 2 0 0 0 3.5 5.5V8"/><path d="M16 3.5h2.5a2 2 0 0 1 2 2V8"/><path d="M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M16 20.5h2.5a2 2 0 0 0 2-2V16"/>',
  list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  gridSm: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',

  // ---------- 状态与对象 ----------
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.5 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.6-3.8 3.7-6.2 7.5-6.2s6.9 2.4 7.5 6.2"/>',
  speaker: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><circle cx="12" cy="14.5" r="3.2"/><path d="M12 7.5h.01"/>',
  cloud: '<path d="M7 18.5a4.2 4.2 0 0 1 .6-8.35 6 6 0 0 1 11.3 1.2A3.6 3.6 0 0 1 18 18.5z"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.2l2 2h7.8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  scan: '<path d="M3.5 8V5.5A2 2 0 0 1 5.5 3.5H8"/><path d="M16 3.5h2.5a2 2 0 0 1 2 2V8"/><path d="M20.5 16v2.5a2 2 0 0 1-2 2H16"/><path d="M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M3.5 12h17"/>',
  zap: '<path d="M13 3 5 13.5h6L11 21l8-10.5h-6z"/>',
};

/** 这些图标用填充而非描边（播放器控件、点状菜单等） */
const FILLED = new Set(['play', 'pause', 'prev', 'next', 'more', 'heart', 'zap']);

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 1.75 },
});

const filled = computed(() => FILLED.has(props.name));
const inner = computed(() => ICONS[props.name] || '');
</script>

<template>
  <svg
    v-if="inner"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    :stroke="filled ? 'none' : 'currentColor'"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="shrink-0"
    aria-hidden="true"
    v-html="inner"
  />
</template>
