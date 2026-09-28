<template>
  <div class="tc-player-bar tc-mini">
    <!-- ============ 空态：队列为空时仍占位，保证布局不跳 ============ -->
    <div v-if="!state.queue.length" class="flex items-center gap-3 min-w-0 flex-1">
      <div class="tc-cover tc-cover-md">
        <Icon name="music" :size="20" class="tc-cover-empty" />
      </div>
      <div class="min-w-0">
        <div class="text-sm text-fg-muted truncate">未在播放</div>
        <div class="text-[11px] text-fg-subtle truncate">从主页或曲库挑一首开始</div>
      </div>
    </div>

    <template v-else>
      <!-- ============ 左：封面 + 曲目信息 + 当前歌词（点直接进入全屏播放页） ============ -->
      <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group" @click="player.expand">
        <div class="tc-cover tc-cover-md">
          <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" alt="" />
          <Icon v-else name="music" :size="20" class="text-accent/70" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 min-w-0">
            <span class="text-sm text-fg truncate shrink-0 max-w-[45%]">{{ cur?.title }}</span>
            <span class="text-[11px] text-fg-muted truncate hidden sm:inline">
              {{ cur?.artist }}<span v-if="cur?.album"> · {{ cur.album }}</span>
            </span>
            <span v-if="state.loading" class="text-[10px] text-amber-400 shrink-0 ml-auto">缓冲中…</span>
            <span v-else-if="state.error" class="text-[10px] text-rose-400 shrink-0 ml-auto">链接失效</span>
          </div>
          <!-- 当前歌词行：跟着进度滚动；没歌词时退回显示专辑/音质 -->
          <div class="text-[11px] truncate mt-0.5" :class="currentLyric ? 'text-accent/90' : 'text-fg-subtle'">
            <template v-if="currentLyric">{{ currentLyric }}</template>
            <template v-else>{{ cur?.album || (state.quality === 'local' ? '本地' : state.quality) || '' }}</template>
          </div>
        </div>
      </div>

      <!-- ============ 中：播放控制 + 进度（桌面） ============ -->
      <div class="flex items-center gap-1 shrink-0">
        <button
          class="tc-icon-btn hidden sm:inline-flex"
          :title="REPEAT_META[state.repeat].label"
          @click="player.cycleRepeat"
        >
          <Icon :name="repeatIcon" :size="17" />
        </button>
        <button class="tc-icon-btn hidden sm:inline-flex" title="上一首" @click="player.prev">
          <Icon name="prev" :size="18" />
        </button>

        <button
          class="w-10 h-10 rounded-full bg-accent text-fg-inverse flex items-center justify-center
                 shrink-0 transition-transform active:scale-95 hover:bg-accent-hover"
          :title="state.playing ? '暂停' : '播放'"
          @click="player.toggle"
        >
          <Icon :name="state.playing ? 'pause' : 'play'" :size="18" />
        </button>

        <button class="tc-icon-btn" title="下一首" @click="player.next">
          <Icon name="next" :size="18" />
        </button>
      </div>

      <!-- 进度条（桌面）：--p 控制已播比例填充 -->
      <div class="hidden lg:flex items-center gap-2 shrink-0 w-[260px]">
        <span class="text-[11px] tc-num text-fg-subtle w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
        <input
          class="tc-range flex-1"
          type="range" min="0" :max="state.duration || 0" step="0.5"
          :value="state.currentTime"
          :style="{ '--p': progressPct + '%' }"
          @input="e => player.seek(Number(e.target.value))"
        />
        <span class="text-[11px] tc-num text-fg-subtle w-9">{{ fmtTime(state.duration) }}</span>
      </div>

      <!-- ============ 右：音量 / 队列 / 全屏（桌面） ============ -->
      <div class="hidden lg:flex items-center gap-1 shrink-0">
        <button class="tc-icon-btn" :title="state.volume > 0 ? '静音' : '取消静音'" @click="toggleMute">
          <Icon :name="state.volume > 0 ? 'volume' : 'mute'" :size="17" />
        </button>
        <input
          class="tc-range w-[72px]"
          type="range" min="0" max="100" step="1"
          :value="state.volume"
          :style="{ '--p': state.volume + '%' }"
          @input="e => player.setVolume(Number(e.target.value))"
        />
        <button class="tc-icon-btn" title="播放队列 / 全屏" @click="player.expand">
          <Icon name="list" :size="17" />
        </button>
        <button class="tc-icon-btn" title="全屏歌词" @click="player.toggleExpand">
          <Icon name="expand" :size="17" />
        </button>
      </div>

      <!-- 移动端：直接进全屏，控制都在全屏页里 -->
      <button class="tc-icon-btn md:hidden shrink-0" title="正在播放" @click="player.expand">
        <Icon name="chevronUp" :size="18" />
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';
import Icon from './Icon.vue';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverUrl = computed(() => player.coverUrl.value);

/** 循环模式 → 图标名（取 REPEAT_META 的唯一出处） */
const repeatIcon = computed(() => REPEAT_META[state.repeat]?.icon || 'repeat');

/** 已播百分比，驱动进度条填充 */
const progressPct = computed(() => (
  state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0
));

/** 当前歌词行（索引由 player 统一算好） */
const currentLyric = computed(() => {
  const lines = state.lyrics?.lines || [];
  const i = state.lyricIndex;
  if (i < 0 || !lines[i]) return '';
  return lines[i].text || lines[i].content || '';
});

let lastVolume = 80;
function toggleMute() {
  if (state.volume > 0) { lastVolume = state.volume; player.setVolume(0); }
  else player.setVolume(lastVolume || 80);
}
</script>
