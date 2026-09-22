<template>
  <div class="space-y-4">
    <!-- 顶部：本地搜索 + 显示方式切换 -->
    <div class="flex gap-2 items-center">
      <div class="relative flex-1">
        <input v-model="localKw" class="tc-input w-full pl-8" placeholder="搜索本地歌曲 / 歌手 / 专辑" />
        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 text-xs">🔍</span>
        <button v-if="localKw" class="absolute right-2 top-1/2 -translate-y-1/2 tc-icon-btn w-6 h-6 text-[10px]"
          title="清空" @click="localKw = ''">✕</button>
      </div>

      <!-- 显示方式：列表 / 小图 / 中图 -->
      <div class="inline-flex rounded-lg border border-ink-700 overflow-hidden shrink-0">
        <button v-for="v in VIEWS" :key="v.id"
          class="px-2.5 py-1.5 text-[11px] transition-colors"
          :class="view === v.id ? 'bg-neon-dim/20 text-neon-soft' : 'text-slate-500 hover:text-slate-300'"
          :title="v.label" @click="setView(v.id)">{{ v.icon }}</button>
      </div>
    </div>

    <div class="flex items-center gap-3 text-xs text-slate-600">
      <span>{{ localKw ? `匹配 ${filtered.length} / ${total}` : `${total} 首` }}</span>
      <button class="hover:text-neon-soft transition-colors" :disabled="loading" @click="load">
        {{ loading ? '载入中…' : '刷新' }}
      </button>
    </div>

    <div v-if="loading && !songs.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
      <div class="text-sm text-slate-500">载入中…</div>
    </div>

    <div v-else-if="!songs.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
      <div class="text-2xl text-slate-700 mb-1">♪</div>
      <div class="text-sm text-slate-500">曲库还没有歌曲</div>
      <div class="text-xs text-slate-600 mt-1">去「曲库」点「扫描」，或用云端搜索入库</div>
    </div>

    <div v-else-if="!filtered.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
      <div class="text-sm text-slate-500">没有匹配「{{ localKw }}」的歌曲</div>
      <div class="text-xs text-slate-600 mt-1">找网络歌曲请去「曲库」搜索</div>
    </div>

    <!-- ============ 列表视图 ============ -->
    <div v-else-if="view === 'list'" class="tc-card overflow-hidden divide-y divide-ink-800">
      <div v-for="(s, i) in filtered" :key="s.id"
        class="px-2 sm:px-4 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50
               transition-colors group cursor-pointer"
        @click="playSong(s)">
        <div class="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-ink-700 flex items-center justify-center relative">
          <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
          <span v-else class="text-slate-500 text-xs">{{ initial(s) }}</span>
          <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white text-xs">▶</div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-slate-200 truncate" :class="{ 'text-neon-soft': isCurrent(s) }">{{ s.title }}</div>
          <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
        </div>
        <span class="text-slate-600 truncate hidden md:inline max-w-[160px] text-xs">{{ s.album }}</span>
        <span class="text-[11px] font-mono text-slate-700 shrink-0">{{ fmtDur(s.duration) }}</span>
        <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
          title="加入队列" @click.stop="appendSong(s)">＋</button>
      </div>
    </div>

    <!-- ============ 小图 / 中图网格 ============ -->
    <div v-else :class="view === 'grid-sm'
      ? 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-3'
      : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4'">
      <div v-for="(s, i) in filtered" :key="s.id" class="group cursor-pointer" @click="playSong(s)">
        <div class="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700/60">
          <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
          <div v-else class="w-full h-full flex items-center justify-center text-slate-700"
            :class="view === 'grid-sm' ? 'text-xl' : 'text-3xl'">♪</div>
          <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55">
            <button class="rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950
                           flex items-center justify-center shadow-glow"
              :class="view === 'grid-sm' ? 'w-8 h-8 text-sm' : 'w-11 h-11'"
              :title="`播放 ${s.title}`">▶</button>
          </div>
        </div>
        <div class="mt-1.5 truncate" :class="view === 'grid-sm'
          ? 'text-[11px] text-slate-300' : 'text-sm text-slate-200'"
          :title="s.title">{{ s.title }}</div>
        <div v-if="view !== 'grid-sm'" class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
      </div>
    </div>

    <div v-if="message" class="tc-card p-3 text-sm"
      :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer, fmtTime } from '../composables/usePlayer.js';

const player = usePlayer();
const cur = computed(() => player.current.value);

const localKw = ref('');
const songs = ref([]);
const total = ref(0);
const loading = ref(false);
const message = ref(null);

/** 显示方式：列表 / 小图 / 中图 */
const VIEWS = [
  { id: 'list',    label: '列表', icon: '☰' },
  { id: 'grid-sm', label: '小图', icon: '▦' },
  { id: 'grid-md', label: '中图', icon: '▣' },
];
const VIEW_KEY = 'tc.home.view';
const view = ref(localStorage.getItem(VIEW_KEY) || 'grid-md');

function setView(v) {
  view.value = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* 隐私模式忽略 */ }
}

/** 本地检索：标题 / 歌手 / 专辑，大小写不敏感 */
const filtered = computed(() => {
  const k = localKw.value.trim().toLowerCase();
  if (!k) return songs.value;
  return songs.value.filter(s =>
    String(s.title || '').toLowerCase().includes(k) ||
    String(s.artist || '').toLowerCase().includes(k) ||
    String(s.album || '').toLowerCase().includes(k));
});

function initial(s) { const t = String(s.title || '').trim(); return t ? t[0].toUpperCase() : '♪'; }
function isCurrent(s) { return cur.value && cur.value.filePath === s.filePath; }
function fmtDur(d) { return d ? fmtTime(d) : '--:--'; }

async function load() {
  loading.value = true;
  try {
    const r = await api.library(500, 0, '');
    songs.value = (r && r.songs) || [];
    total.value = (r && r.total) ?? songs.value.length;
  } catch (e) {
    message.value = { ok: false, text: '载入失败：' + e };
  } finally { loading.value = false; }
}

function toQueue(list) {
  return list.map(s => ({
    title: s.title, artist: s.artist, album: s.album,
    filePath: s.filePath, platform: 'local', songId: String(s.id), cover: s.cover,
  }));
}

async function playSong(s) {
  const i = filtered.value.findIndex(x => x.id === s.id);
  await player.playList(toQueue(filtered.value), Math.max(0, i));
}

async function appendSong(s) {
  await player.append(toQueue([s]));
  message.value = { ok: true, text: `已加入队列：${s.title}` };
  setTimeout(() => { message.value = null; }, 1800);
}

onMounted(() => { load(); });
</script>
