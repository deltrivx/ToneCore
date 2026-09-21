<template>
  <!-- 全屏播放页：左歌词 / 右封面（PC），移动端上下堆叠 -->
  <div class="fixed inset-0 z-50 bg-ink-900 flex flex-col">
    <!-- 顶栏 -->
    <div class="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-ink-700">
      <button class="tc-icon-btn w-8 h-8" title="收起" @click="toggleExpand">⌄</button>
      <div class="min-w-0">
        <div class="text-sm text-slate-200 truncate">{{ cur?.title || '未在播放' }}</div>
        <div class="text-[11px] text-slate-600 truncate">{{ cur?.artist || '—' }}</div>
      </div>
      <span v-if="state.quality" class="tc-badge text-[10px] ml-auto shrink-0">
        {{ state.quality === 'local' ? '本地' : state.quality }}
      </span>
    </div>

    <!-- 主体 -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row">
      <!-- 封面区 -->
      <div class="md:w-[46%] shrink-0 flex items-center justify-center p-6 md:p-10
                  md:border-r md:border-ink-700">
        <div class="relative w-full max-w-[380px] aspect-square rounded-2xl overflow-hidden
                    bg-gradient-to-br from-ink-800 to-ink-850 border border-ink-700 shadow-card
                    flex items-center justify-center">
          <img v-if="player.coverUrl.value" :src="player.coverUrl.value" class="w-full h-full object-cover" alt="" />
          <span v-else class="text-neon-soft" style="font-size:96px;line-height:1">♫</span>
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
          <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-slate-600">
            <span class="text-3xl">♪</span>
            <span class="text-sm">{{ lyricHint }}</span>
          </div>
          <!-- 底部留白：让最后几行也能滚到中间 -->
          <div class="h-[45vh]"></div>
        </div>

        <!-- 控制区 -->
        <div class="shrink-0 border-t border-ink-700 px-4 md:px-6 py-4 space-y-3">
          <!-- 进度 -->
          <div class="flex items-center gap-3">
            <span class="text-[11px] font-mono text-slate-600 w-10 text-right">
              {{ fmtTime(state.currentTime) }}
            </span>
            <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime" @input="e => seek(Number(e.target.value))" />
            <span class="text-[11px] font-mono text-slate-600 w-10">{{ fmtTime(state.duration) }}</span>
          </div>

          <!-- 按钮 -->
          <div class="flex items-center justify-center gap-4 md:gap-6">
            <button class="tc-icon-btn w-9 h-9" :title="REPEAT_META[state.repeat].label"
              @click="cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
            <button class="tc-icon-btn w-10 h-10" title="上一首" @click="prev">⏮</button>
            <button class="w-14 h-14 rounded-full bg-gradient-to-br from-neon-dim to-neon
                           text-ink-950 flex items-center justify-center text-xl
                           hover:shadow-glow-lg transition-shadow"
              :title="state.playing ? '暂停' : '播放'" @click="toggle">
              {{ state.playing ? '⏸' : '▶' }}
            </button>
            <button class="tc-icon-btn w-10 h-10" title="下一首" @click="next">⏭</button>
            <button class="tc-icon-btn w-9 h-9" title="播放队列" @click="showQueue = !showQueue">☰</button>
          </div>

          <!-- 音量 -->
          <div class="flex items-center justify-center gap-2">
            <span class="text-xs text-slate-600">{{ state.volume > 0 ? '🔊' : '🔇' }}</span>
            <input class="tc-range max-w-[200px]" type="range" min="0" max="100" step="1"
              :value="state.volume" @input="e => setVolume(Number(e.target.value))" />
            <span class="text-[11px] font-mono text-slate-600 w-8">{{ state.volume }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 播放队列抽屉 -->
    <transition name="tc-queue">
      <div v-if="showQueue"
        class="absolute right-0 top-14 bottom-0 w-full md:w-[340px] bg-ink-850 border-l border-ink-700
               flex flex-col shadow-card">
        <div class="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-ink-700">
          <span class="text-sm font-medium text-slate-300">播放队列</span>
          <span class="text-[11px] text-slate-600 font-mono">{{ state.queue.length }}</span>
          <button class="tc-btn text-xs py-1 px-2 ml-auto" @click="clear">清空</button>
          <button class="tc-icon-btn w-7 h-7" @click="showQueue = false">✕</button>
        </div>
        <div class="flex-1 overflow-y-auto divide-y divide-ink-800">
          <div v-for="(s, i) in state.queue" :key="s.uid"
            class="px-3 py-2.5 flex items-center gap-3 cursor-pointer group"
            :class="i === state.index ? 'bg-ink-800' : 'hover:bg-ink-800/50'"
            @click="jump(i)">
            <span class="w-5 text-center shrink-0 text-[11px] font-mono"
              :class="i === state.index ? 'text-neon' : 'text-slate-700'">
              <span v-if="i === state.index && state.playing" class="tc-bars inline-flex">
                <i></i><i></i><i></i>
              </span>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate" :class="i === state.index ? 'text-neon-soft' : 'text-slate-300'">
                {{ s.title }}
              </div>
              <div class="text-[11px] text-slate-600 truncate">{{ s.artist }}</div>
            </div>
            <button class="tc-icon-btn w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100
                           text-rose-400/70 hover:text-rose-400 text-[10px]"
              title="从队列移除" @click.stop="removeAt(s.uid)">✕</button>
          </div>
          <div v-if="!state.queue.length" class="py-10 text-center text-sm text-slate-600">
            队列为空
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const { toggle, next, prev, seek, setVolume, cycleRepeat, jump, removeAt, clear, toggleExpand } = player;

const showQueue = ref(false);
const lyricBox = ref(null);

/** 没有歌词时区分「纯音乐」与「还没取到」 */
const lyricHint = computed(() => {
  if (state.lyrics.source === 'none') return '暂无歌词';
  return '纯音乐，请欣赏';
});

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
