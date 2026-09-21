<template>
  <div class="space-y-4 max-w-3xl mx-auto">
    <!-- 空态：引导去搜索 -->
    <div v-if="!cur" class="tc-card p-10 text-center space-y-3">
      <div class="text-5xl text-neon-soft">♫</div>
      <div class="text-slate-300">还没有在播放的歌</div>
      <div class="text-sm text-slate-600">去「搜索」找一首歌，或从「音乐库」里挑一首开始</div>
    </div>

    <template v-else>
      <!-- 当前曲目大卡 -->
      <div class="tc-card p-5 flex flex-col sm:flex-row items-center gap-5">
        <div class="w-[140px] h-[140px] shrink-0 rounded-xl overflow-hidden bg-ink-800
                    border border-ink-700 flex items-center justify-center">
          <img v-if="player.coverUrl.value" :src="player.coverUrl.value" class="w-full h-full object-cover" alt="" />
          <span v-else class="text-neon-soft" style="font-size:52px;line-height:1">♫</span>
        </div>

        <div class="min-w-0 flex-1 w-full space-y-3">
          <div class="text-center sm:text-left">
            <div class="text-xl font-semibold text-slate-100 truncate">{{ cur.title }}</div>
            <div class="text-sm text-slate-500 truncate mt-0.5">{{ cur.artist }}</div>
            <div class="flex items-center gap-2 mt-2 flex-wrap justify-center sm:justify-start">
              <span class="tc-badge text-[10px]">
                {{ cur.origin === 'local' ? '本地曲库' : cur.platform.toUpperCase() + ' 在线' }}
              </span>
              <span v-if="state.quality" class="tc-badge text-[10px]">
                {{ state.quality === 'local' ? '本地文件' : state.quality }}
              </span>
              <span v-if="state.loading" class="text-[11px] text-amber-400">缓冲中…</span>
            </div>
          </div>

          <!-- 进度 -->
          <div class="flex items-center gap-3">
            <span class="text-[11px] font-mono text-slate-600 w-10 text-right">
              {{ fmtTime(state.currentTime) }}
            </span>
            <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime" @input="e => seek(Number(e.target.value))" />
            <span class="text-[11px] font-mono text-slate-600 w-10">{{ fmtTime(state.duration) }}</span>
          </div>

          <!-- 控制 -->
          <div class="flex items-center justify-center sm:justify-start gap-3">
            <button class="tc-icon-btn w-9 h-9" :title="REPEAT_META[state.repeat].label"
              @click="cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
            <button class="tc-icon-btn w-10 h-10" title="上一首" @click="prev">⏮</button>
            <button class="w-12 h-12 rounded-full bg-gradient-to-br from-neon-dim to-neon
                           text-ink-950 flex items-center justify-center text-lg
                           hover:shadow-glow transition-shadow"
              @click="toggle">{{ state.playing ? '⏸' : '▶' }}</button>
            <button class="tc-icon-btn w-10 h-10" title="下一首" @click="next">⏭</button>
            <button class="tc-btn text-xs py-1.5 ml-1" @click="toggleExpand">全屏歌词</button>
          </div>

          <div v-if="state.error" class="text-xs text-amber-400 text-center sm:text-left">
            {{ state.error }}
          </div>
        </div>
      </div>

      <!-- 歌词预览 -->
      <div class="tc-card overflow-hidden">
        <div class="px-4 py-3 border-b border-ink-700 text-sm font-medium text-slate-300">
          歌词
          <span class="text-[11px] text-slate-600 ml-2 font-normal">
            {{ state.lyrics.source === 'lrc-file' ? '本地 .lrc' :
               state.lyrics.source === 'online' ? '在线获取' : '暂无' }}
          </span>
        </div>
        <div class="max-h-[300px] overflow-y-auto px-4 py-3" ref="box">
          <template v-if="state.lyrics.lines.length">
            <div v-for="(l, i) in state.lyrics.lines" :key="i"
              class="py-1 text-sm transition-colors cursor-pointer"
              :class="i === state.lyricIndex ? 'text-neon-soft font-medium' : 'text-slate-600 hover:text-slate-400'"
              @click="seek(l.time)">
              {{ l.text }}
            </div>
          </template>
          <div v-else class="py-8 text-center text-sm text-slate-600">
            暂无歌词
          </div>
        </div>
      </div>

      <!-- 队列 -->
      <div class="tc-card overflow-hidden">
        <div class="px-4 py-3 border-b border-ink-700 flex items-center gap-2">
          <span class="text-sm font-medium text-slate-300">播放队列</span>
          <span class="text-[11px] text-slate-600 font-mono">{{ state.queue.length }}</span>
          <button class="tc-btn text-xs py-1 px-2 ml-auto" @click="clear">清空</button>
        </div>
        <div v-if="!state.queue.length" class="py-8 text-center text-sm text-slate-600">队列为空</div>
        <div v-else class="divide-y divide-ink-800 max-h-[420px] overflow-y-auto">
          <div v-for="(s, i) in state.queue" :key="s.uid"
            class="px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer group"
            :class="i === state.index ? 'bg-ink-800' : 'hover:bg-ink-800/50'"
            @click="jump(i)">
            <span class="w-5 shrink-0 text-center text-[11px] font-mono"
              :class="i === state.index ? 'text-neon' : 'text-slate-700'">
              <span v-if="i === state.index && state.playing" class="tc-bars inline-flex">
                <i></i><i></i><i></i>
              </span>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="truncate flex-1" :class="i === state.index ? 'text-neon-soft' : 'text-slate-300'">
              {{ s.title }}
            </span>
            <span class="text-slate-600 truncate hidden sm:inline max-w-[130px]">{{ s.artist }}</span>
            <button class="tc-icon-btn w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100
                           text-rose-400/70 hover:text-rose-400 text-[10px]"
              title="移除" @click.stop="removeAt(s.uid)">✕</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const { toggle, next, prev, seek, cycleRepeat, jump, removeAt, clear, toggleExpand } = player;

const box = ref(null);

/** 歌词自动跟随滚动（与全屏页同一套思路：算 scrollTop，不用 scrollIntoView） */
watch(() => state.lyricIndex, async (i) => {
  if (i < 0 || !box.value) return;
  const el = box.value.children[i];
  if (!el) return;
  await nextTick();
  const target = el.offsetTop - box.value.clientHeight / 2 + el.clientHeight / 2;
  box.value.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
});
</script>
