<template>
  <!--
    上浮式「正在播放」面板。
    以封面做整块模糊背景（这首歌是主角），大封面 + 信息，控制区居中，
    歌词滚动跟随，队列默认折叠避免信息过载。
    交互：点面板外空白收纳；点右上角按钮手动收起。
  -->
  <div class="fixed inset-0 z-40" @click="closeSheet">
    <div class="absolute inset-0 bg-black/60"></div>

    <div class="absolute inset-x-0 bottom-[124px] md:bottom-[72px] flex justify-center px-2 md:px-4" @click.stop>
      <div class="tc-sheet relative w-full max-w-2xl max-h-[74vh] flex flex-col overflow-hidden
                  rounded-xl border border-line-strong bg-surface-raised shadow-pop">

        <!-- 封面模糊着色背景 -->
        <div v-if="coverUrl" class="absolute inset-0 scale-125 blur-2xl opacity-30"
          :style="{ backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }"></div>
        <div class="absolute inset-0 bg-gradient-to-b from-surface/90 via-surface/95 to-surface-sunken/98"></div>

        <div class="relative flex flex-col min-h-0">
          <!-- 抬头 -->
          <div class="shrink-0 px-4 py-2.5 flex items-center gap-2 border-b border-line">
            <span class="text-[11px] uppercase tracking-[0.18em] text-fg-muted">正在播放</span>
            <span v-if="state.queue.length" class="text-[11px] tc-num text-fg-subtle">
              {{ state.index + 1 }} / {{ state.queue.length }}
            </span>
            <div class="ml-auto flex items-center gap-1">
              <button class="tc-icon-btn tc-icon-btn-sm" title="全屏歌词" @click="player.toggleExpand">
                <Icon name="expand" :size="15" />
              </button>
              <button class="tc-icon-btn tc-icon-btn-sm" title="清空队列" @click="player.clear">
                <Icon name="trash" :size="15" />
              </button>
              <button class="tc-btn-ghost text-xs" title="收纳" @click="closeSheet">
                <Icon name="chevronDown" :size="15" />
                <span>收纳</span>
              </button>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
            <!-- 封面 + 信息 -->
            <div class="p-5 flex gap-5">
              <div class="w-28 h-28 sm:w-36 sm:h-36 shrink-0 rounded-lg overflow-hidden
                          bg-surface-overlay border border-line flex items-center justify-center">
                <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" alt="" />
                <Icon v-else name="music" :size="40" class="text-fg-subtle" />
              </div>
              <div class="min-w-0 flex-1 flex flex-col justify-center">
                <div class="text-lg sm:text-xl font-semibold text-fg truncate leading-snug">
                  {{ cur?.title || '未在播放' }}
                </div>
                <div class="text-sm text-fg-muted truncate mt-1">{{ cur?.artist || '—' }}</div>
                <div class="text-xs text-fg-subtle truncate mt-0.5">{{ cur?.album || '' }}</div>
                <div class="flex items-center gap-2 mt-2.5 flex-wrap">
                  <span class="tc-chip text-[10px]">
                    {{ cur?.origin === 'local' ? '本地' : (cur?.platform || '').toUpperCase() }}
                  </span>
                  <span v-if="state.quality" class="text-[10px] tc-num text-fg-subtle">{{ state.quality }}</span>
                  <span v-if="state.loading" class="text-[10px] text-amber-400">缓冲中…</span>
                  <span v-else-if="state.error" class="text-[10px] text-rose-400">链接失效</span>
                </div>
              </div>
            </div>

            <!-- 进度 -->
            <div class="px-5 flex items-center gap-3">
              <span class="text-[11px] tc-num text-fg-subtle w-10 text-right">{{ fmtTime(state.currentTime) }}</span>
              <input
                class="tc-range flex-1"
                type="range" min="0" :max="state.duration || 0" step="0.5"
                :value="state.currentTime"
                :style="{ '--p': progressPct + '%' }"
                @input="e => player.seek(Number(e.target.value))"
              />
              <span class="text-[11px] tc-num text-fg-subtle w-10">{{ fmtTime(state.duration) }}</span>
            </div>

            <!-- 控制区 -->
            <div class="px-5 py-4 flex items-center justify-center gap-4">
              <button class="tc-icon-btn" :title="REPEAT_META[state.repeat].label" @click="player.cycleRepeat">
                <Icon :name="REPEAT_META[state.repeat].icon" :size="18" />
              </button>
              <button class="tc-icon-btn" title="上一首" @click="player.prev">
                <Icon name="prev" :size="20" />
              </button>
              <button
                class="w-14 h-14 rounded-full bg-accent text-fg-inverse flex items-center justify-center
                       transition-transform active:scale-95 hover:bg-accent-hover"
                @click="player.toggle">
                <Icon :name="state.playing ? 'pause' : 'play'" :size="24" />
              </button>
              <button class="tc-icon-btn" title="下一首" @click="player.next">
                <Icon name="next" :size="20" />
              </button>
              <button class="tc-icon-btn" :title="state.volume > 0 ? '静音' : '取消静音'" @click="toggleMute">
                <Icon :name="state.volume > 0 ? 'volume' : 'mute'" :size="18" />
              </button>
            </div>

            <!-- 音量 -->
            <div class="px-5 pb-4 flex items-center gap-3">
              <input
                class="tc-range flex-1"
                type="range" min="0" max="100" step="1"
                :value="state.volume"
                :style="{ '--p': state.volume + '%' }"
                @input="e => player.setVolume(Number(e.target.value))"
              />
              <span class="text-[11px] tc-num text-fg-subtle w-8 text-right">{{ state.volume }}</span>
            </div>

            <!-- 歌词：滚动跟随，当前行高亮 -->
            <div class="border-t border-line">
              <div class="px-5 py-2 flex items-center gap-2">
                <span class="text-xs text-fg-muted">歌词</span>
                <span v-if="state.lyrics.source && state.lyrics.source !== 'none'"
                  class="text-[10px] font-mono text-fg-subtle">{{ state.lyrics.source }}</span>
              </div>
              <div ref="lyricBox" class="max-h-[240px] overflow-y-auto px-5 pb-4 space-y-0.5">
                <template v-if="lyricLines.length">
                  <div v-for="(l, i) in lyricLines" :key="i"
                    class="py-1 text-center transition-all duration-300 cursor-pointer rounded"
                    :class="i === state.lyricIndex
                      ? 'text-accent text-base font-medium'
                      : 'text-fg-subtle text-sm hover:text-fg-muted'"
                    @click="player.seek(l.time)">
                    {{ l.text }}
                  </div>
                </template>
                <div v-else class="py-6 text-center text-xs text-fg-subtle">
                  {{ state.lyrics.source === 'none' ? '暂无歌词' : '歌词加载中…' }}
                </div>
              </div>
            </div>

            <!-- 队列：折叠，避免默认信息过载 -->
            <div class="border-t border-line">
              <button class="w-full px-5 py-2.5 flex items-center gap-2 text-xs text-fg-muted hover:text-fg"
                @click="showQueue = !showQueue">
                <span>播放队列</span>
                <span class="tc-num text-fg-subtle">{{ state.queue.length }}</span>
                <Icon :name="showQueue ? 'chevronDown' : 'chevronRight'" :size="15" class="ml-auto" />
              </button>
              <div v-if="showQueue" class="divide-y divide-line max-h-[220px] overflow-y-auto">
                <div v-for="(s, i) in state.queue" :key="s.uid"
                  class="px-5 py-2 flex items-center gap-3 text-xs cursor-pointer group"
                  :class="i === state.index ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'"
                  @click="player.jump(i)">
                  <span class="w-4 shrink-0 text-center tc-num text-[10px]"
                    :class="i === state.index ? 'text-accent' : 'text-fg-subtle'">
                    <span v-if="i === state.index && state.playing" class="tc-bars inline-flex"><i></i><i></i><i></i></span>
                    <template v-else>{{ i + 1 }}</template>
                  </span>
                  <span class="truncate flex-1" :class="i === state.index ? 'text-accent' : 'text-fg-muted'">
                    {{ s.title }}
                  </span>
                  <span class="truncate text-fg-subtle hidden sm:inline max-w-[110px]">{{ s.artist }}</span>
                  <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100"
                    title="移除" @click.stop="player.removeAt(s.uid)">
                    <Icon name="x" :size="13" />
                  </button>
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
import Icon from './Icon.vue';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverUrl = computed(() => player.coverUrl.value);

const { closeSheet } = player;
const showQueue = ref(false);
const lyricBox = ref(null);
let lastVolume = 80;

const lyricLines = computed(() => state.lyrics?.lines || []);

/** 已播百分比，驱动进度条填充 */
const progressPct = computed(() => (
  state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0
));

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
