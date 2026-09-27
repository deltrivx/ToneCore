<template>
  <!-- 全屏播放页：左封面 / 右歌词（PC），移动端上下堆叠 -->
  <div class="fixed inset-0 z-50 bg-surface flex flex-col">
    <!-- 顶栏 -->
    <div class="h-[58px] shrink-0 flex items-center gap-3 px-4 border-b border-line">
      <button class="tc-icon-btn" title="收起" @click="toggleExpand">
        <Icon name="chevronDown" :size="20" />
      </button>
      <div class="min-w-0">
        <div class="text-sm text-fg truncate">{{ cur?.title || '未在播放' }}</div>
        <div class="text-[11px] text-fg-subtle truncate">{{ cur?.artist || '—' }}</div>
      </div>
      <span v-if="state.quality" class="tc-chip ml-auto shrink-0">
        {{ state.quality === 'local' ? '本地' : state.quality }}
      </span>
    </div>

    <!-- 主体 -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row">
      <!-- 封面区 -->
      <div class="md:w-[46%] shrink-0 flex items-center justify-center p-6 md:p-10 md:border-r md:border-line">
        <div class="relative w-full max-w-[380px] aspect-square rounded-xl overflow-hidden
                    bg-surface-overlay border border-line flex items-center justify-center">
          <img v-if="player.coverUrl.value" :src="player.coverUrl.value" class="w-full h-full object-cover" alt="" />
          <Icon v-else name="music" :size="88" class="text-accent/40" />
        </div>
      </div>

      <!-- 歌词区 -->
      <div class="flex-1 min-h-0 flex flex-col">
        <div ref="lyricBox" class="flex-1 min-h-0 overflow-y-auto px-6 py-8 space-y-0.5">
          <template v-if="state.lyrics.lines.length">
            <div v-for="(l, i) in state.lyrics.lines" :key="i"
              class="tc-lyric-line cursor-pointer"
              :class="i === state.lyricIndex ? 'tc-lyric-active' : 'tc-lyric-idle'"
              @click="seek(l.time)">
              {{ l.text }}
            </div>
          </template>
          <div v-else class="h-full flex flex-col items-center justify-center gap-3 text-fg-subtle">
            <Icon name="music" :size="34" />
            <span class="text-sm">{{ lyricHint }}</span>
          </div>
          <!-- 底部留白：让最后几行也能滚到中间 -->
          <div class="h-[45vh]"></div>
        </div>

        <!-- 控制区 -->
        <div class="shrink-0 border-t border-line px-4 md:px-6 py-4 space-y-3">
          <!-- 进度 -->
          <div class="flex items-center gap-3">
            <span class="text-[11px] tc-num text-fg-subtle w-10 text-right">{{ fmtTime(state.currentTime) }}</span>
            <input
              class="tc-range flex-1"
              type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime"
              :style="{ '--p': progressPct + '%' }"
              @input="e => seek(Number(e.target.value))"
            />
            <span class="text-[11px] tc-num text-fg-subtle w-10">{{ fmtTime(state.duration) }}</span>
          </div>

          <!-- 按钮 -->
          <div class="flex items-center justify-center gap-4 md:gap-6">
            <button class="tc-icon-btn" :title="REPEAT_META[state.repeat].label" @click="cycleRepeat">
              <Icon :name="REPEAT_META[state.repeat].icon" :size="18" />
            </button>
            <button class="tc-icon-btn" title="上一首" @click="prev">
              <Icon name="prev" :size="20" />
            </button>
            <button
              class="w-14 h-14 rounded-full bg-accent text-fg-inverse flex items-center justify-center
                     transition-transform active:scale-95 hover:bg-accent-hover"
              :title="state.playing ? '暂停' : '播放'" @click="toggle">
              <Icon :name="state.playing ? 'pause' : 'play'" :size="24" />
            </button>
            <button class="tc-icon-btn" title="下一首" @click="next">
              <Icon name="next" :size="20" />
            </button>
            <button class="tc-icon-btn" title="播放队列" @click="showQueue = !showQueue">
              <Icon name="list" :size="18" />
            </button>
          </div>

          <!-- 音量 -->
          <div class="flex items-center justify-center gap-2">
            <button class="tc-icon-btn" :title="state.volume > 0 ? '静音' : '取消静音'" @click="toggleMute">
              <Icon :name="state.volume > 0 ? 'volume' : 'mute'" :size="17" />
            </button>
            <input
              class="tc-range max-w-[200px]"
              type="range" min="0" max="100" step="1"
              :value="state.volume"
              :style="{ '--p': state.volume + '%' }"
              @input="e => setVolume(Number(e.target.value))"
            />
            <span class="text-[11px] tc-num text-fg-subtle w-8">{{ state.volume }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 播放队列抽屉 -->
    <transition name="tc-queue">
      <div v-if="showQueue"
        class="absolute right-0 top-[58px] bottom-0 w-full md:w-[340px] bg-surface-raised border-l border-line
               flex flex-col shadow-pop">
        <div class="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
          <span class="text-sm font-medium text-fg">播放队列</span>
          <span class="text-[11px] tc-num text-fg-subtle">{{ state.queue.length }}</span>
          <button class="tc-btn-ghost text-xs ml-auto" @click="clear">清空</button>
          <button class="tc-icon-btn" @click="showQueue = false">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
          <div v-if="!state.queue.length" class="tc-empty">
            <div class="tc-empty-icon"><Icon name="music" :size="20" /></div>
            <div class="tc-empty-title">队列为空</div>
          </div>
          <div v-for="(s, i) in state.queue" :key="s.uid"
            class="tc-row group"
            :class="{ 'tc-row-active': i === state.index }"
            @click="jump(i)">
            <span class="w-5 text-center shrink-0 text-[11px] tc-num"
              :class="i === state.index ? 'text-accent' : 'text-fg-subtle'">
              <span v-if="i === state.index && state.playing" class="tc-bars inline-flex">
                <i></i><i></i><i></i>
              </span>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate" :class="i === state.index ? 'text-accent' : 'text-fg'">{{ s.title }}</div>
              <div class="text-[11px] text-fg-muted truncate">{{ s.artist }}</div>
            </div>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100
                           text-rose-400/70 hover:text-rose-400"
              title="从队列移除" @click.stop="removeAt(s.uid)">
              <Icon name="x" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';
import Icon from './Icon.vue';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const { toggle, next, prev, seek, setVolume, cycleRepeat, jump, removeAt, clear, toggleExpand } = player;

const showQueue = ref(false);
const lyricBox = ref(null);

/** 已播百分比，驱动进度条填充 */
const progressPct = computed(() => (
  state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0
));

/** 没有歌词时区分「纯音乐」与「还没取到」 */
const lyricHint = computed(() => {
  if (state.lyrics.source === 'none') return '暂无歌词';
  return '纯音乐，请欣赏';
});

let lastVolume = 80;
function toggleMute() {
  if (state.volume > 0) { lastVolume = state.volume; setVolume(0); }
  else setVolume(lastVolume || 80);
}

/**
 * 当前歌词行变化时把它滚到视口中间。
 * 用 scrollTop 直接算而不是 scrollIntoView —— 后者会连带外层容器一起滚，
 * 在这个「内层滚动 + 全屏固定」的结构里会把封面顶掉。
 */
watch(() => state.lyricIndex, async (i) => {
  if (i < 0 || !lyricBox.value) return;
  const box = lyricBox.value;
  const el = box.children[i];
  if (!el) return;
  await nextTick();
  const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
});
</script>

<style scoped>
.tc-queue-enter-active, .tc-queue-leave-active { transition: transform 0.25s ease; }
.tc-queue-enter-from, .tc-queue-leave-to { transform: translateX(100%); }
</style>
