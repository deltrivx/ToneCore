<template>
  <!--
    底部常驻播放条。
    - **始终常驻**：没有队列时显示空态（不再整体消失），保证位置固定。
    - 显示专辑封面、标题、歌手、**当前歌词行**（滚动跟随）。
    - 点击曲目区上浮「正在播放」面板（不离开当前页面）。
  -->
  <div class="tc-mini">
    <div v-if="!state.queue.length" class="flex items-center gap-3 min-w-0 flex-1 text-slate-600">
      <div class="w-10 h-10 shrink-0 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center">
        <span class="text-slate-700 text-lg">♫</span>
      </div>
      <div class="min-w-0">
        <div class="text-sm truncate">未在播放</div>
        <div class="text-[11px] text-slate-700 truncate">从主页或曲库挑一首开始</div>
      </div>
    </div>

    <template v-else>
      <!-- 封面 + 曲目信息 + 歌词（点击上浮） -->
      <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group" @click="player.openSheet">
        <div class="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-ink-800
                    flex items-center justify-center border border-ink-700 shadow-md">
          <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" alt="" />
          <span v-else class="text-neon-soft text-lg">♫</span>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 min-w-0">
            <span class="text-sm text-slate-100 truncate shrink-0 max-w-[45%]">{{ cur?.title }}</span>
            <span class="text-[11px] text-slate-500 truncate hidden sm:inline">{{ cur?.artist }}<span
              v-if="cur?.album"> · {{ cur.album }}</span></span>
            <span v-if="state.loading" class="text-[10px] text-amber-400 shrink-0 sm:ml-auto">缓冲中…</span>
            <span v-else-if="state.error" class="text-[10px] text-rose-400 shrink-0 sm:ml-auto">链接失效</span>
          </div>
          <!-- 当前歌词行：跟着进度滚动，没歌词时退回显示专辑/音质 -->
          <div class="text-[11px] truncate mt-0.5" :class="currentLyric ? 'text-neon-soft/90' : 'text-slate-600'">
            <template v-if="currentLyric">{{ currentLyric }}</template>
            <template v-else>{{ cur?.album || (state.quality === 'local' ? '本地' : state.quality) || '' }}</template>
          </div>
        </div>

        <span class="shrink-0 text-[10px] text-slate-600 group-hover:text-neon-soft transition-colors">
          {{ state.sheetOpen ? '▾' : '▴' }}
        </span>
      </div>

      <!-- 控制 -->
      <div class="flex items-center gap-1 shrink-0">
        <button class="hidden sm:inline-flex tc-icon-btn w-8 h-8" :title="REPEAT_META[state.repeat].label"
          @click="player.cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
        <button class="tc-icon-btn w-8 h-8" title="上一首" @click="player.prev">⏮</button>
        <button class="w-9 h-9 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950
                       flex items-center justify-center shadow-glow shrink-0"
          :title="state.playing ? '暂停' : '播放'" @click="player.toggle">
          <span class="text-sm">{{ state.playing ? '⏸' : '▶' }}</span>
        </button>
        <button class="tc-icon-btn w-8 h-8" title="下一首" @click="player.next">⏭</button>
      </div>

      <!-- 进度（PC） -->
      <div class="hidden md:flex items-center gap-2 shrink-0 w-[240px]">
        <span class="text-[11px] font-mono text-slate-600 w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
        <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
          :value="state.currentTime" @input="e => player.seek(Number(e.target.value))" />
        <span class="text-[11px] font-mono text-slate-600 w-9">{{ fmtTime(state.duration) }}</span>
      </div>

      <!-- 音量（PC） -->
      <div class="hidden lg:flex items-center gap-2 shrink-0">
        <span class="text-xs text-slate-600">{{ state.volume > 0 ? '🔊' : '🔇' }}</span>
        <input class="tc-range w-[72px]" type="range" min="0" max="100" step="1"
          :value="state.volume" @input="e => player.setVolume(Number(e.target.value))" />
      </div>

      <button class="hidden md:inline-flex tc-icon-btn w-8 h-8 shrink-0 text-xs"
        title="全屏歌词" @click="player.toggleExpand">⤢</button>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverUrl = computed(() => player.coverUrl.value);

/** 当前歌词行（跟随时长走，索引由 player 统一算好） */
const currentLyric = computed(() => {
  const lines = state.lyrics?.lines || [];
  const i = state.lyricIndex;
  if (i < 0 || !lines[i]) return '';
  return lines[i].text || lines[i].content || '';
});
</script>
