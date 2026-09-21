<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">曲库</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          共 <span class="text-neon-soft font-mono">{{ data?.total ?? 0 }}</span> 首
          <template v-if="data?.keyword">
            · 匹配「<span class="text-slate-400">{{ data.keyword }}</span>」
          </template>
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button class="tc-btn" :disabled="scanning" @click="scan">
          {{ scanning ? '扫描中…' : '扫描' }}
        </button>
        <button class="tc-btn" :disabled="auditing" @click="audit">
          {{ auditing ? '审计中…' : '元数据审计' }}
        </button>
        <button class="tc-btn" :disabled="backfilling" @click="backfill">
          {{ backfilling ? '补全中…' : '补全标签' }}
        </button>
      </div>
    </div>

    <!-- 统计卡 -->
    <div v-if="stats" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="tc-card p-3">
        <div class="text-xs text-slate-500 mb-0.5">曲目</div>
        <div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.total }}</div>
      </div>
      <div class="tc-card p-3">
        <div class="text-xs text-slate-500 mb-0.5">歌手</div>
        <div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.artists }}</div>
      </div>
      <div class="tc-card p-3">
        <div class="text-xs text-slate-500 mb-0.5">专辑</div>
        <div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.albums }}</div>
      </div>
      <div class="tc-card p-3">
        <div class="text-xs text-slate-500 mb-0.5">今日新增</div>
        <div class="text-lg font-semibold font-mono"
          :class="stats.addedToday > 0 ? 'text-neon-soft' : 'text-slate-100'">
          {{ stats.addedToday }}
        </div>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="flex gap-2">
      <input v-model="keyword" class="tc-input flex-1"
        placeholder="搜索歌名 / 歌手 / 专辑，回车确认" @keyup.enter="applySearch" />
      <button class="tc-btn-primary shrink-0" @click="applySearch">搜索</button>
      <button v-if="data?.keyword" class="tc-btn shrink-0" @click="clearSearch">清空</button>
    </div>

    <!-- 审计 / 补全结果 -->
    <div v-if="auditResult" class="tc-card p-3 text-sm flex flex-wrap gap-4">
      <span class="text-slate-400">检查 <b class="text-slate-200">{{ auditResult.checked }}</b> 首</span>
      <span class="text-slate-400">缺封面 <b class="text-amber-400">{{ auditResult.missingCover }}</b></span>
      <span class="text-slate-400">缺元数据 <b class="text-amber-400">{{ auditResult.missingMeta }}</b></span>
      <span class="text-slate-400">缺歌词 <b class="text-amber-400">{{ auditResult.missingLyrics ?? 0 }}</b></span>
    </div>
    <div v-if="backfillResult" class="tc-card p-3 text-sm flex flex-wrap gap-4">
      <span class="text-slate-400">扫描 <b class="text-slate-200">{{ backfillResult.scanned }}</b></span>
      <span class="text-slate-400">补全 <b class="text-emerald-400">{{ backfillResult.fixed }}</b></span>
      <span class="text-slate-400">失败 <b class="text-slate-600">{{ backfillResult.failed }}</b></span>
    </div>

    <!-- 当前播放（试听走后端播放器，与「正在播放」页共用同一个队列） -->
    <div v-if="player.state.queue.length" class="tc-card p-3 flex items-center gap-3">
      <span class="tc-dot tc-dot-ok shrink-0"></span>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-slate-300 truncate">
          {{ player.current.value?.title || '未在播放' }}
        </div>
        <div class="text-xs text-slate-600 truncate">{{ player.current.value?.artist }}</div>
      </div>
      <button class="tc-btn-primary text-xs shrink-0" @click="player.toggle">
        {{ player.state.playing ? '暂停' : '播放' }}
      </button>
      <button class="tc-btn text-xs shrink-0" @click="player.clear">停止</button>
    </div>

    <div v-if="!data?.songs?.length" class="tc-card p-8 text-center text-sm text-slate-600">
      {{ data?.keyword ? '没有匹配的曲目' : '曲库为空，点击「扫描」建立索引' }}
    </div>

    <template v-else>
      <div class="tc-card overflow-hidden divide-y divide-ink-800">
        <div v-for="(s, i) in data.songs" :key="s.id"
          class="px-2 sm:px-4 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group cursor-pointer"
          @dblclick="play(s, i)">
          <!-- 封面：有缓存图就显示，没有则用首字母占位 -->
          <div class="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-ink-700
                      flex items-center justify-center relative">
            <img v-if="s.cover" :src="`/cover/${s.cover}`" :alt="s.title"
                 class="w-full h-full object-cover" loading="lazy" />
            <span v-else class="text-slate-500 text-sm font-medium">{{ initial(s) }}</span>
            <!-- 悬停时封面变播放键 -->
            <button class="absolute inset-0 hidden group-hover:flex items-center justify-center
                           bg-black/55 text-white text-sm" title="播放" @click.stop="play(s, i)">
              ▶
            </button>
          </div>

          <div class="min-w-0 flex-1">
            <div class="text-slate-200 truncate"
                 :class="{ 'text-neon-soft': player.current.value?.id === s.id }">{{ s.title }}</div>
            <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
          </div>

          <span class="text-slate-600 truncate hidden md:inline max-w-[150px] text-xs">{{ s.album }}</span>
          <span class="font-mono text-[10px] text-slate-700 shrink-0 hidden lg:inline">
            {{ ext(s.filePath) }}
          </span>
          <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
            title="添加到队列" @click.stop="addOne(s)">＋</button>
          <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70 hover:text-rose-400"
            :disabled="deletingId === s.id" title="移入回收站" @click.stop="remove(s)">
            <span class="text-xs">{{ deletingId === s.id ? '…' : '✕' }}</span>
          </button>
        </div>
      </div>

      <!-- 分页 -->
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="text-slate-600 text-xs">
          第 {{ offset + 1 }} – {{ Math.min(offset + PAGE, data.total) }} 条
        </span>
        <div class="flex gap-2">
          <button class="tc-btn text-xs" :disabled="offset === 0" @click="page(-1)">上一页</button>
          <button class="tc-btn text-xs" :disabled="offset + PAGE >= data.total" @click="page(1)">下一页</button>
        </div>
      </div>
    </template>

    <div v-if="message" class="tc-card p-3 text-sm" :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer } from '../composables/usePlayer.js';

const PAGE = 50;
const player = usePlayer();

const data = ref(null);
const stats = ref(null);
const keyword = ref('');
const offset = ref(0);
const scanning = ref(false);
const auditing = ref(false);
const backfilling = ref(false);
const auditResult = ref(null);
const backfillResult = ref(null);
const deletingId = ref(null);
const message = ref(null);

/** 取文件扩展名，用于列表右侧的格式标记 */
function ext(p) {
  const m = /\.([^.]+)$/.exec(p || '');
  return m ? m[1].toUpperCase() : '';
}

async function load() {
  data.value = await api.library(PAGE, offset.value, keyword.value);
}

async function loadStats() {
  stats.value = await api.libraryStats();
}

function applySearch() {
  offset.value = 0;
  load();
}

function clearSearch() {
  keyword.value = '';
  offset.value = 0;
  load();
}

function page(dir) {
  offset.value = Math.max(0, offset.value + dir * PAGE);
  load();
}

/**
 * 播放曲库歌曲。
 *
 * 这里刻意把**整页曲目**当作队列交给播放器（而不是只播一首），
 * 这样「下一首」能顺着列表往下走 —— 符合音乐播放器的通行行为。
 */
function play(song, index) {
  const songs = (data.value?.songs || []).map((s) => ({
    title: s.title, artist: s.artist, album: s.album,
    filePath: s.filePath, platform: 'local', songId: String(s.id),
  }));
  const at = Math.max(0, index ?? songs.findIndex((s) => s.filePath === song.filePath));
  player.playList(songs, at);
}

/** 无封面时的占位字符：取歌名首字（中文一字足够辨识，英文取首字母大写） */
function initial(song) {
  const t = String(song.title || '').trim();
  return t ? t[0].toUpperCase() : '♪';
}

/** 单首加入队列（不打断当前播放） */
async function addOne(song) {
  await player.append([{
    title: song.title, artist: song.artist, album: song.album,
    filePath: song.filePath, platform: 'local', songId: String(song.id),
  }]);
  message.value = { ok: true, text: `已添加到队列：${song.title}` };
}

async function scan() {
  scanning.value = true;
  message.value = null;
  try {
    const r = await api.scan();
    await Promise.all([load(), loadStats()]);
    message.value = { ok: true, text: `扫描完成，新增 ${r.added ?? 0} 首，共 ${r.total ?? 0} 首` };
  } finally { scanning.value = false; }
}

async function audit() {
  auditing.value = true;
  try { auditResult.value = await api.audit(200); } finally { auditing.value = false; }
}

async function backfill() {
  backfilling.value = true;
  message.value = null;
  try {
    backfillResult.value = await api.backfill(20);
    await load();
  } finally { backfilling.value = false; }
}

async function remove(song) {
  if (!confirm(`将「${song.title}」移入回收站？\n文件不会立即删除，可在 /data/_trash 找回。`)) return;
  deletingId.value = song.id;
  message.value = null;
  try {
    const r = await api.libraryDelete(song.filePath);
    message.value = r.ok
      ? { ok: true, text: `已移入回收站：${song.title}` }
      : { ok: false, text: r.error || '删除失败' };
    if (r.ok) {
      await Promise.all([load(), loadStats()]);
    }
  } finally { deletingId.value = null; }
}

onMounted(() => {
  load();
  loadStats();
});
</script>
