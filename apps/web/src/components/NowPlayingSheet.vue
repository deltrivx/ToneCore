<template>
  <!--
    上浮式「正在播放」面板。
    参照成熟音乐平台（Apple Music / Spotify）的沉浸式设计：
      - 以封面做整块模糊背景，视觉上「这首歌就是主角」
      - 大封面 + 标题/歌手，控制区居中，进度条可拖拽
      - 歌词区滚动跟随（当前行高亮）
      - 队列折叠在下方，默认收起，避免信息过载
    交互：点面板外空白收纳；点「收纳」按钮手动收起。
  -->
  <div class="fixed inset-0 z-40" @click="closeSheet">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

    <div class="absolute inset-x-0 bottom-[124px] md:bottom-[72px] flex justify-center px-2 md:px-4"
      @click.stop>
      <div class="relative w-full max-w-2xl max-h-[74vh] flex flex-col overflow-hidden
                  rounded-2xl border border-white/10 shadow-2xl
                  animate-[tcSheetUp_.24s_cubic-bezier(.16,1,.3,1)]">

        <!-- 封面模糊着色背景 -->
        <div v-if="coverUrl" class="absolute inset-0 scale-125 blur-2xl opacity-40"
          :style="{ backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }"></div>
        <div class="absolute inset-0 bg-gradient-to-b from-ink-900/92 via-ink-900/96 to-ink-950/98"></div>

        <div class="relative flex flex-col min-h-0">
          <!-- 抬头 -->
          <div class="shrink-0 px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.06]">
            <span class="text-[11px] uppercase tracking-[0.18em] text-slate-400">正在播放</span>
            <span v-if="state.queue.length" class="text-[11px] text-slate-500 font-mono">
              {{ state.index + 1 }} / {{ state.queue.length }}
            </span>
            <div class="ml-auto flex items-center gap-1">
              <button class="tc-icon-btn w-7 h-7 text-xs" title="全屏歌词" @click="player.toggleExpand">⤢</button>
              <button class="tc-icon-btn w-7 h-7 text-xs" title="清空队列" @click="player.clear">🗑</button>
              <button class="tc-btn text-xs py-1 px-2.5" title="收纳" @click="closeSheet">▾ 收纳</button>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
            <!-- 封面 + 信息 -->
            <div class="p-5 flex gap-5">
              <div class="w-28 h-28 sm:w-36 sm:h-36 shrink-0 rounded-xl overflow-hidden bg-ink-800
                          ring-1 ring-white/10 shadow-2xl flex items-center justify-center">
                <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" alt="" />
                <span v-else class="text-4xl text-slate-700">♫</span>
              </div>
              <div class="min-w-0 flex-1 flex flex-col justify-center">
                <div class="text-lg sm:text-xl font-semibold text-white truncate leading-snug">{{ cur?.title || '未在播放' }}</div>
                <div class="text-sm text-slate-300/90 truncate mt-1">{{ cur?.artist || '—' }}</div>
                <div class="text-xs text-slate-500 truncate mt-0.5">{{ cur?.album || '' }}</div>
                <div class="flex items-center gap-2 mt-2.5">
                  <span class="tc-badge text-[10px]">{{ cur?.origin === 'local' ? '本地' : (cur?.platform || '').toUpperCase() }}</span>
                  <span v-if="state.quality" class="text-[10px] text-slate-500 font-mono">{{ state.quality }}</span>
                  <span v-if="state.loading" class="text-[10px] text-amber-400">缓冲中…</span>
                  <span v-else-if="state.error" class="text-[10px] text-rose-400">链接失效</span>
                </div>
              </div>
            </div>

            <!-- 进度（原生 range 自带拖拽，比自绘可靠） -->
            <div class="px-5 flex items-center gap-3">
              <span class="text-[11px] font-mono text-slate-500 w-10 text-right">{{ fmtTime(state.currentTime) }}</span>
              <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
                :value="state.currentTime" @input="e => player.seek(Number(e.target.value))" />
              <span class="text-[11px] font-mono text-slate-500 w-10">{{ fmtTime(state.duration) }}</span>
            </div>

            <!-- 控制区 -->
            <div class="px-5 py-4 flex items-center justify-center gap-4">
              <button class="tc-icon-btn w-9 h-9" :title="REPEAT_META[state.repeat].label" @click="player.cycleRepeat">
                {{ REPEAT_META[state.repeat].icon }}
              </button>
              <button class="tc-icon-btn w-10 h-10 text-lg" title="上一首" @click="player.prev">⏮</button>
              <button class="w-14 h-14 rounded-full bg-white text-ink-950 flex items-center justify-center text-xl
                             shadow-[0_8px_30px_rgba(255,255,255,0.18)] hover:scale-105 transition-transform"
                @click="player.toggle">{{ state.playing ? '⏸' : '▶' }}</button>
              <button class="tc-icon-btn w-10 h-10 text-lg" title="下一首" @click="player.next">⏭</button>
              <button class="tc-icon-btn w-9 h-9" :title="state.volume > 0 ? '静音' : '取消静音'"
                @click="toggleMute">{{ state.volume > 0 ? '🔊' : '🔇' }}</button>
            </div>

            <!-- 音量 -->
            <div class="px-5 pb-4 flex items-center gap-3">
              <input class="tc-range flex-1" type="range" min="0" max="100" step="1"
                :value="state.volume" @input="e => player.setVolume(Number(e.target.value))" />
              <span class="text-[11px] font-mono text-slate-500 w-8 text-right">{{ state.volume }}</span>
            </div>

            <!-- 歌词：滚动跟随，当前行高亮 -->
            <div class="border-t border-white/[0.06]">
              <div class="px-5 py-2 flex items-center gap-2">
                <span class="text-xs text-slate-400">歌词</span>
                <span v-if="state.lyrics.source && state.lyrics.source !== 'none'"
                  class="text-[10px] text-slate-600 font-mono">{{ state.lyrics.source }}</span>
              </div>
              <div ref="lyricBox" class="max-h-[240px] overflow-y-auto px-5 pb-4 space-y-0.5">
                <template v-if="lyricLines.length">
                  <div v-for="(l, i) in lyricLines" :key="i"
                    class="py-1 text-center transition-all duration-300 cursor-pointer rounded"
                    :class="i === state.lyricIndex
                      ? 'text-neon-soft text-base font-medium'
                      : 'text-slate-500 text-sm hover:text-slate-300'"
                    @click="player.seek(l.time)">
                    {{ l.text }}
                  </div>
                </template>
                <div v-else class="py-6 text-center text-xs text-slate-600">
                  {{ state.lyrics.source === 'none' ? '暂无歌词' : '歌词加载中…' }}
                </div>
              </div>
            </div>

            <!-- 队列：折叠，避免默认信息过载 -->
            <div class="border-t border-white/[0.06]">
              <button class="w-full px-5 py-2.5 flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
                @click="showQueue = !showQueue">
                <span>播放队列</span>
                <span class="font-mono text-slate-600">{{ state.queue.length }}</span>
                <span class="ml-auto text-slate-600">{{ showQueue ? '▾' : '▸' }}</span>
              </button>
              <div v-if="showQueue" class="divide-y divide-white/[0.04] max-h-[220px] overflow-y-auto">
                <div v-for="(s, i) in state.queue" :key="s.uid"
                  class="px-5 py-2 flex items-center gap-3 text-xs cursor-pointer group"
                  :class="i === state.index ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'"
                  @click="player.jump(i)">
                  <span class="w-4 shrink-0 text-center font-mono text-[10px]"
                    :class="i === state.index ? 'text-neon' : 'text-slate-600'">
                    <span v-if="i === state.index && state.playing" class="tc-bars inline-flex"><i></i><i></i><i></i></span>
                    <template v-else>{{ i + 1 }}</template>
                  </span>
                  <span class="truncate flex-1" :class="i === state.index ? 'text-neon-soft' : 'text-slate-400'">
                    {{ s.title }}
                  </span>
                  <span class="truncate text-slate-600 hidden sm:inline max-w-[110px]">{{ s.artist }}</span>
                  <button class="tc-icon-btn w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
                    title="移除" @click.stop="player.removeAt(s.uid)">✕</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverUrl = computed(() => player.coverUrl.value);

const { closeSheet } = player;
const showQueue = ref(false);
const lyricBox = ref(null);
let lastVolume = 80;

const lyricLines = computed(() => state.lyrics?.lines || []);

function toggleMute() {
  if (state.volume > 0) { lastVolume = state.volume; player.setVolume(0); }
  else player.setVolume(lastVolume || 80);
}

/** 当前行滚到可视区中间，做「歌词跟着唱」的观感 */
function scrollToActive() {
  nextTick(() => {
    const box = lyricBox.value;
    if (!box || state.lyricIndex < 0) return;
    const el = box.children[state.lyricIndex];
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  });
}

onMounted(scrollToActive);
watch(() => state.lyricIndex, scrollToActive);
</script>
