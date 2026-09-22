<template>
  <!--
    上浮式「正在播放」面板。
    点底部播放条弹出，点面板外任意空白处自动收纳，或点右上角「收纳」按钮手动收起。
    与全屏播放页（FullPlayer）是两件事：这里是不离开当前页面的浮层。
  -->
  <div class="fixed inset-0 z-40" @click="closeSheet">
    <!-- 遮罩：点它就是「点击空白处收纳」 -->
    <div class="absolute inset-0 bg-black/55"></div>

    <!-- 浮层本体：贴着底部播放条上方升起（移动端还要避开底部 Tab） -->
    <div class="absolute inset-x-0 bottom-[124px] md:bottom-[72px] flex justify-center px-2 md:px-4"
      @click.stop>
      <div class="w-full max-w-lg max-h-[68vh] flex flex-col overflow-hidden
                  rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl
                  animate-[tcSheetUp_.22s_ease-out]">

        <!-- 抬头：标题 + 收纳 -->
        <div class="shrink-0 px-4 py-2.5 border-b border-ink-700 flex items-center gap-2">
          <span class="text-xs uppercase tracking-widest text-slate-500">正在播放</span>
          <span v-if="state.queue.length" class="text-[11px] text-slate-600 font-mono">
            {{ state.index + 1 }}/{{ state.queue.length }}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <button class="tc-icon-btn w-7 h-7 text-xs" title="全屏歌词" @click="player.toggleExpand">⤢</button>
            <button class="tc-icon-btn w-7 h-7 text-xs" title="清空队列" @click="player.clear">🗑</button>
            <!-- 收纳：收起本浮层，底部播放条继续常驻 -->
            <button class="tc-btn text-xs py-1 px-2" title="收纳" @click="closeSheet">▾ 收纳</button>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto">
          <!-- 曲目区 -->
          <div class="p-4 flex gap-4">
            <div class="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-xl overflow-hidden bg-ink-800 border border-ink-700 flex items-center justify-center">
              <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-3xl text-slate-700">♫</span>
            </div>
            <div class="min-w-0 flex-1 flex flex-col justify-center">
              <div class="text-base font-semibold text-slate-100 truncate">{{ cur?.title || '未在播放' }}</div>
              <div class="text-sm text-slate-400 truncate mt-0.5">{{ cur?.artist || '—' }}</div>
              <div class="text-xs text-slate-600 truncate mt-0.5">{{ cur?.album || '' }}</div>
              <div class="flex items-center gap-1.5 mt-2">
                <span class="tc-badge text-[10px]">
                  {{ cur?.origin === 'local' ? '本地' : (cur?.platform || '').toUpperCase() }}
                </span>
                <span v-if="state.loading" class="text-[10px] text-amber-400">缓冲中…</span>
                <span v-if="state.error" class="text-[10px] text-rose-400">链接失效</span>
              </div>
            </div>
          </div>

          <!-- 进度 -->
          <div class="px-4 flex items-center gap-2">
            <span class="text-[10px] font-mono text-slate-600 w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
            <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime" @input="e => seek(Number(e.target.value))" />
            <span class="text-[10px] font-mono text-slate-600 w-9">{{ fmtTime(state.duration) }}</span>
          </div>

          <!-- 控制 -->
          <div class="px-4 py-3 flex items-center justify-center gap-3">
            <button class="tc-icon-btn w-9 h-9" :title="REPEAT_META[state.repeat].label" @click="cycleRepeat">
              {{ REPEAT_META[state.repeat].icon }}
            </button>
            <button class="tc-icon-btn w-9 h-9" title="上一首" @click="prev">⏮</button>
            <button class="w-12 h-12 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950
                           flex items-center justify-center text-lg hover:shadow-glow transition-shadow"
              @click="toggle">{{ state.playing ? '⏸' : '▶' }}</button>
            <button class="tc-icon-btn w-9 h-9" title="下一首" @click="next">⏭</button>
            <button class="tc-icon-btn w-9 h-9" title="音量" @click="showVol = !showVol">🔊</button>
          </div>

          <div v-if="showVol" class="px-4 pb-3 flex items-center gap-2">
            <input class="tc-range flex-1" type="range" min="0" max="100" step="1"
              :value="state.volume" @input="e => setVolume(Number(e.target.value))" />
            <span class="text-[11px] font-mono text-slate-600 w-8 text-right">{{ state.volume }}</span>
          </div>

          <!-- 队列 -->
          <div class="border-t border-ink-700">
            <div class="px-4 py-2 text-xs text-slate-500">播放队列</div>
            <div class="divide-y divide-ink-800">
              <div v-for="(s, i) in state.queue" :key="s.uid"
                class="px-4 py-2 flex items-center gap-2 text-xs cursor-pointer group"
                :class="i === state.index ? 'bg-ink-800' : 'hover:bg-ink-800/50'"
                @click="jump(i)">
                <span class="w-4 shrink-0 text-center font-mono text-[10px]"
                  :class="i === state.index ? 'text-neon' : 'text-slate-700'">
                  <span v-if="i === state.index && state.playing" class="tc-bars inline-flex"><i></i><i></i><i></i></span>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="truncate flex-1" :class="i === state.index ? 'text-neon-soft' : 'text-slate-400'">
                  {{ s.title }}
                </span>
                <button class="tc-icon-btn w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100
                               text-rose-400/70 hover:text-rose-400 text-[10px]"
                  title="移除" @click.stop="removeAt(s.uid)">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverUrl = computed(() => player.coverUrl.value);

const { toggle, next, prev, jump, seek, setVolume, cycleRepeat, removeAt, closeSheet } = player;
const showVol = ref(false);
</script>
