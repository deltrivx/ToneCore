<template>
  <!-- 迷你播放条：常驻底部，点中间区域展开全屏播放页 -->
  <div class="tc-mini">
    <!-- 左：封面 + 曲目信息 -->
    <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" @click="toggleExpand">
      <div class="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-ink-800
                  flex items-center justify-center border border-ink-700">
        <img v-if="player.coverUrl.value" :src="player.coverUrl.value" class="w-full h-full object-cover" alt="" />
        <span v-else class="text-neon-soft text-lg">♫</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-slate-200 truncate">{{ cur?.title || '未在播放' }}</div>
        <div class="text-[11px] text-slate-600 truncate">
          {{ cur?.artist || '—' }}
          <span v-if="state.quality" class="font-mono ml-1 text-slate-700">
            · {{ state.quality === 'local' ? '本地' : state.quality }}
          </span>
        </div>
      </div>
    </div>

    <!-- 中：控制按钮 -->
    <div class="flex items-center gap-1 shrink-0">
      <button class="tc-icon-btn w-8 h-8" title="上一首" @click="prev">⏮</button>
      <button class="tc-icon-btn w-9 h-9 text-neon-soft" :title="state.playing ? '暂停' : '播放'"
        @click="toggle">
        <span class="text-sm">{{ state.playing ? '⏸' : '▶' }}</span>
      </button>
      <button class="tc-icon-btn w-8 h-8" title="下一首" @click="next">⏭</button>
    </div>

    <!-- 右：进度（PC 才显示文字）+ 音量 -->
    <div class="hidden md:flex items-center gap-2 shrink-0 w-[240px]">
      <span class="text-[11px] font-mono text-slate-600 w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
      <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
        :value="state.currentTime" @input="e => seek(Number(e.target.value))" />
      <span class="text-[11px] font-mono text-slate-600 w-9">{{ fmtTime(state.duration) }}</span>
    </div>

    <!-- 音量（移动端隐藏，避免挤占） -->
    <div class="hidden md:flex items-center gap-2 shrink-0">
      <span class="text-xs text-slate-600">{{ state.volume > 0 ? '🔊' : '🔇' }}</span>
      <input class="tc-range w-[72px]" type="range" min="0" max="100" step="1"
        :value="state.volume" @input="e => setVolume(Number(e.target.value))" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePlayer, fmtTime } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const { toggle, next, prev, seek, setVolume, toggleExpand } = player;
</script>
