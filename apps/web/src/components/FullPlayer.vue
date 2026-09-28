<template>
  <!--
    全屏播放页：QQ 音乐「大屏」风格
      · 封面放大模糊铺满整屏做沉浸背景
      · 居中大碟（播放时缓慢旋转，暂停即停）
      · 右侧歌词，当前行高亮放大
      · 底部整幅控制区（进度 / 主控制 / 音量）
    移动端自动上下堆叠，主控制区保持可单手操作。
  -->
  <div class="fixed inset-0 z-50 overflow-hidden bg-surface">
    <!-- 背景层：封面模糊 + 暗色渐变压底，保证文字对比度 -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <img v-if="player.coverUrl.value" :src="player.coverUrl.value"
        class="absolute inset-0 w-full h-full object-cover scale-125 blur-[72px] opacity-45" alt="" />
      <div class="absolute inset-0 bg-gradient-to-b from-surface/70 via-surface/85 to-surface"></div>
    </div>

    <div class="relative h-full flex flex-col">
      <!-- 顶栏 -->
      <div class="h-[58px] shrink-0 flex items-center gap-3 px-4 md:px-6">
        <button class="tc-icon-btn" title="收起" @click="toggleExpand">
          <Icon name="chevronDown" :size="20" />
        </button>
        <span class="text-[11px] tracking-[0.2em] text-fg-subtle uppercase">正在播放</span>
        <span v-if="state.quality" class="tc-chip ml-auto shrink-0">
          {{ state.quality === 'local' ? '本地' : state.quality }}
        </span>
        <button class="tc-icon-btn" title="播放队列" @click="showQueue = !showQueue">
          <Icon name="list" :size="18" />
        </button>
      </div>

      <!-- 主体 -->
      <div class="flex-1 min-h-0 flex flex-col md:flex-row md:items-stretch gap-4 md:gap-8 px-4 md:px-8 pb-2">
        <!-- 左：大碟 + 曲目信息 -->
        <div class="md:w-[44%] shrink-0 flex flex-col items-center justify-center gap-5 min-h-0">
          <!--
            只有专辑图响应左右滑。
            此前手势挂在整页根节点上、并平移整个内容层 —— 播放界面会整体抖动，
            而且和歌词区滚动、进度条拖动互相打架。现在手势与位移都只作用于大碟。
          -->
          <div
            class="relative w-[min(42vh,300px)] md:w-[min(46vh,340px)] aspect-square shrink-0 will-change-transform"
            :class="dragActive ? '' : 'transition-transform duration-200 ease-out'"
            :style="{ transform: `translateX(${swipeShift}px)` }"
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend.passive="onTouchEnd"
          >
            <!-- 黑胶底盘 -->
            <div class="absolute inset-[-6%] rounded-full bg-black/55 border border-white/10
                        shadow-[0_18px_50px_rgba(0,0,0,0.55)]"></div>
            <!-- 封面：播放时缓慢旋转 -->
            <div class="absolute inset-0 rounded-full overflow-hidden tc-disc"
              :class="{ 'tc-disc-paused': !state.playing }">
              <img v-if="player.coverUrl.value" :src="player.coverUrl.value"
                class="w-full h-full object-cover" alt="" />
              <div v-else class="w-full h-full flex items-center justify-center bg-surface-overlay">
                <Icon name="music" :size="72" class="text-accent/40" />
              </div>
            </div>
            <!-- 中心轴孔 -->
            <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                        w-[14%] aspect-square rounded-full bg-surface border border-white/15"></div>
          </div>

          <div class="text-center min-w-0 w-full px-2">
            <div class="text-lg md:text-xl font-medium text-fg truncate">{{ cur?.title || '未在播放' }}</div>
            <div class="mt-1 text-[13px] text-fg-muted truncate">
              {{ cur?.artist || '未知歌手' }}<span v-if="cur?.album"> · {{ cur.album }}</span>
            </div>
          </div>
        </div>

        <!-- 右：歌词 -->
        <div class="flex-1 min-h-0 flex flex-col">
          <!-- 歌词校准：带前奏的歌整首平移，只能整体校正 -->
          <div v-if="state.lyrics.lines.length"
            class="shrink-0 flex items-center justify-center gap-1.5 px-4 py-1.5">
            <span class="text-[10px] text-fg-subtle">歌词校准</span>
            <!-- 一键对齐：听到某句正在唱时点这里，比反复 ±0.5s 试快得多 -->
            <button class="tc-btn-ghost text-[11px] px-1.5 py-0.5"
              title="听到某句正在唱时点一下：把这句对齐到此刻（整首偏移一次到位）"
              @click="alignLyricToNow">对齐</button>
            <button class="tc-btn-ghost text-[11px] px-1.5 py-0.5"
              title="歌词整体提前 0.5 秒（歌词比唱的慢时用）" @click="setLyricOffset(0.5)">提前</button>
            <span class="tc-num text-[11px] w-12 text-center"
              :class="state.lyricOffset ? 'text-accent' : 'text-fg-subtle'">
              {{ (state.lyricOffset > 0 ? '+' : '') + Number(state.lyricOffset || 0).toFixed(1) }}s
            </span>
            <button class="tc-btn-ghost text-[11px] px-1.5 py-0.5"
              title="歌词整体延后 0.5 秒（歌词比唱的快、有前奏时用这个）" @click="setLyricOffset(-0.5)">延后</button>
            <button v-if="state.lyricOffset" class="tc-btn-ghost text-[11px] px-1.5 py-0.5"
              title="恢复默认" @click="resetLyricOffset">重置</button>
          </div>

          <div ref="lyricBox" class="flex-1 min-h-0 overflow-y-auto px-2 md:px-6 py-4 text-center">
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
        </div>
      </div>

      <!-- 底部控制区 -->
      <div class="shrink-0 px-4 md:px-8 pb-5 pt-3">
        <div class="max-w-[820px] mx-auto space-y-3">
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

          <!-- 主控制：音量块给了固定宽度，保证播放键始终居中 -->
          <div class="flex items-center justify-center gap-5 md:gap-8">
            <button class="tc-icon-btn" :title="REPEAT_META[state.repeat].label" @click="cycleRepeat">
              <Icon :name="REPEAT_META[state.repeat].icon" :size="18" />
            </button>
            <button class="tc-icon-btn" title="上一首" @click="prev">
              <Icon name="prev" :size="22" />
            </button>
            <button
              class="w-14 h-14 rounded-full bg-accent text-fg-inverse flex items-center justify-center
                     shadow-[0_6px_20px_rgba(79,195,247,0.35)]
                     transition-transform active:scale-95 hover:bg-accent-hover"
              :title="state.playing ? '暂停' : '播放'" @click="toggle">
              <Icon :name="state.playing ? 'pause' : 'play'" :size="24" />
            </button>
            <button class="tc-icon-btn" title="下一首" @click="next">
              <Icon name="next" :size="22" />
            </button>

            <div class="flex items-center gap-1.5 w-[104px] justify-end">
              <button class="tc-icon-btn" :title="state.volume > 0 ? '静音' : '取消静音'" @click="toggleMute">
                <Icon :name="state.volume > 0 ? 'volume' : 'mute'" :size="17" />
              </button>
              <input
                class="tc-range w-[64px]"
                type="range" min="0" max="100" step="1"
                :value="state.volume"
                :style="{ '--p': state.volume + '%' }"
                @input="e => setVolume(Number(e.target.value))"
              />
            </div>
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
const { setLyricOffset, alignLyricToNow } = player;

/** 归零：直接把当前偏移反向补回去即可（setLyricOffset 是增量式） */
function resetLyricOffset() { setLyricOffset(-(state.lyricOffset || 0)); }

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

// ---------- 左右滑切歌 ----------
//
// 主流音乐 App 的全屏播放页都支持「左滑下一首 / 右滑上一首」，
// 这里按同一手势对齐。两个必须避开的干扰源：
//   1) 横向 range 滑块（进度条、音量）—— 它们自己要响应横向拖动，
//      手势若也吃掉横向位移，用户就没法拖进度了；
//   2) 歌词区的纵向滚动 —— 竖向位移不算切歌。
// 因此判据是：起点不在 range 上、且横向位移明显大于纵向。

const swipe = { x0: 0, y0: 0, t0: 0, active: false, locking: true };
/** 触发阈值：太小的位移当成误触 */
const SWIPE_MIN = 60;
/** 横向必须比纵向明显更大，避免斜着划也算 */
const SWIPE_RATIO = 1.5;

/** 跟手位移（px）：拖动时实时跟手，松手后回弹或滑出 */
const swipeShift = ref(0);
/** 手指正按着专辑图拖动中：此时不加过渡，才能实时跟手 */
const dragActive = ref(false);
/** 正在播放切歌动画时锁住，避免连续触发 */
const swiping = ref(false);

function onTouchStart(e) {
  const t = e.touches && e.touches[0];
  if (!t) return;
  // 落在滑块上的触摸交给滑块自己处理
  const tag = (t.target && t.target.tagName ? String(t.target.tagName) : '').toLowerCase();
  const type = t.target && t.target.type ? String(t.target.type).toLowerCase() : '';
  if (tag === 'input' || type === 'range') { swipe.active = false; return; }
  if (swiping.value) { swipe.active = false; return; }
  swipe.active = true;
  swipe.locking = true;      // 先判方向，确认是横向再开始跟手
  swipe.x0 = t.clientX;
  swipe.y0 = t.clientY;
  swipe.t0 = Date.now();
  swipeShift.value = 0;
}

function onTouchMove(e) {
  if (!swipe.active) return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dx = t.clientX - swipe.x0;
  const dy = t.clientY - swipe.y0;
  // 方向锁：首次超过 8px 时判定，纵向占优就彻底放弃这次手势
  if (swipe.locking) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dx) < Math.abs(dy)) { swipe.active = false; return; }
    swipe.locking = false;
  }
  // 阻尼：越拖越沉，避免一划到底
  dragActive.value = true;
  swipeShift.value = dx * 0.55;
}

async function onTouchEnd(e) {
  dragActive.value = false;
  if (!swipe.active) { swipeShift.value = 0; return; }
  swipe.active = false;
  // 队列抽屉打开时不切歌，避免误触（此时用户大概率在操作列表）
  if (showQueue.value) { swipeShift.value = 0; return; }
  const t = e.changedTouches && e.changedTouches[0];
  if (!t) { swipeShift.value = 0; return; }
  const dx = t.clientX - swipe.x0;
  const dy = t.clientY - swipe.y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < SWIPE_MIN || adx < ady * SWIPE_RATIO) {
    swipeShift.value = 0;                    // 没到阈值，回弹
    return;
  }

  // 确认切歌：先整屏滑出，再换曲，然后从另一侧滑入
  const toNext = dx < 0;                     // 左滑下一首；右滑上一首
  swiping.value = true;
  const w = window.innerWidth || 400;
  swipeShift.value = toNext ? -w : w;
  await new Promise((r) => setTimeout(r, 180));
  if (toNext) await next(); else await prev();
  swipeShift.value = toNext ? w : -w;        // 瞬移到反侧（无动画）
  await new Promise((r) => setTimeout(r, 20));
  swipeShift.value = 0;                      // 滑回正中
  await new Promise((r) => setTimeout(r, 200));
  swiping.value = false;
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
/* 大碟旋转：暂停时停在原处，不做重置，观感更自然 */
.tc-disc { animation: tc-rotate 24s linear infinite; }
.tc-disc-paused { animation-play-state: paused; }
@keyframes tc-rotate { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .tc-disc { animation: none; }
}

.tc-queue-enter-active, .tc-queue-leave-active { transition: transform 0.25s ease; }
.tc-queue-enter-from, .tc-queue-leave-to { transform: translateX(100%); }
</style>
