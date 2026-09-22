<template>
  <div class="space-y-5">
    <!-- ============ 顶部：全网搜索（与主页一致的入口） ============ -->
    <div class="flex gap-2">
      <input v-model="onlineKwInput" class="tc-input flex-1" placeholder="全网搜索歌曲 / 歌手（回车）"
        @keyup.enter="doOnlineSearch" />
      <button class="tc-btn-primary shrink-0" :disabled="onlineSearching" @click="doOnlineSearch">
        {{ onlineSearching ? '搜索中…' : '全网搜索' }}
      </button>
    </div>

    <!-- 在线结果（内联，不跳页） -->
    <OnlineSearch v-if="onlineKw" :keyword="onlineKw" />

    <!-- ============ 本地曲库（onlineKw 为空时才显示） ============ -->
    <template v-if="!onlineKw">
      <!-- 头部：标题 + 统计 + 操作；右上角小框 = 仅本地搜索 -->
      <div class="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-slate-100">曲库</h1>
          <p class="text-sm text-slate-500 mt-0.5">
            共 <span class="text-neon-soft font-mono">{{ data?.total ?? 0 }}</span> 首
            <template v-if="localKw">· 本地匹配「<span class="text-slate-400">{{ localKw }}</span>」</template>
          </p>
        </div>
        <div class="flex gap-2 flex-wrap items-center">
          <!-- 右上角小搜索框：仅本地 -->
          <div class="relative">
            <input v-model="localKw" class="tc-input w-44 pl-7" placeholder="本地搜索"
              @input="onLocalInput" />
            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 text-xs">🔍</span>
          </div>
          <button class="tc-btn text-xs" :disabled="scanning" @click="scan">{{ scanning ? '扫描中…' : '扫描' }}</button>
          <button class="tc-btn text-xs" :disabled="auditing" @click="audit">{{ auditing ? '审计中…' : '元数据审计' }}</button>
          <button class="tc-btn text-xs" :disabled="backfilling" @click="backfill">{{ backfilling ? '补全中…' : '补全标签' }}</button>
        </div>
      </div>

      <!-- 失效曲目：文件被外部删除，索引里仍有残留 -->
      <div v-if="missingCount > 0"
        class="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06]">
        <span class="text-sm text-amber-300">
          ⚠ 有 <b class="font-mono">{{ missingCount }}</b> 首曲目在磁盘上已不存在（文件被外部删除），仍残留在曲库中。
        </span>
        <button class="tc-btn text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          :disabled="pruning" @click="prune">
          {{ pruning ? '清理中…' : '清理失效曲目' }}
        </button>
        <button class="tc-icon-btn w-6 h-6 text-slate-500" title="重新检查" @click="checkMissing">↻</button>
      </div>

      <!-- 统计卡 -->
      <div v-if="stats && !localKw" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="tc-card p-3"><div class="text-xs text-slate-500 mb-0.5">曲目</div><div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.total }}</div></div>
        <div class="tc-card p-3"><div class="text-xs text-slate-500 mb-0.5">歌手</div><div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.artists }}</div></div>
        <div class="tc-card p-3"><div class="text-xs text-slate-500 mb-0.5">专辑</div><div class="text-lg font-semibold text-slate-100 font-mono">{{ stats.albums }}</div></div>
        <div class="tc-card p-3"><div class="text-xs text-slate-500 mb-0.5">今日新增</div><div class="text-lg font-semibold font-mono" :class="stats.addedToday>0?'text-neon-soft':'text-slate-100'">{{ stats.addedToday }}</div></div>
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

      <!-- ============ 歌单（歌单归曲库，不再占主页版面） ============ -->
      <section v-if="!localKw">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-base font-semibold text-slate-100">歌单</h2>
          <button class="text-xs text-slate-500 hover:text-neon-soft transition-colors" @click="createPlaylist">
            ＋ 新建
          </button>
        </div>

        <div v-if="!playlists.length" class="rounded-xl border border-dashed border-ink-700 p-6 text-center">
          <div class="text-sm text-slate-500">还没有歌单</div>
          <div class="text-xs text-slate-600 mt-1">在下方曲目上点「⤓ 加入歌单」，或点右上角新建</div>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div v-for="pl in playlists" :key="pl.id" class="group cursor-pointer" @click="openPlaylist(pl)">
            <div class="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700/60">
              <img v-if="pl.cover" :src="`/cover/${pl.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-3xl text-slate-700">♫</div>
              <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55">
                <button class="w-11 h-11 rounded-full bg-gradient-to-br from-neon-dim to-neon
                               text-ink-950 flex items-center justify-center shadow-glow"
                  title="播放歌单" @click.stop="playPlaylist(pl)">▶</button>
              </div>
              <button class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-rose-300/80
                             opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px]"
                title="删除歌单" @click.stop="delPlaylist(pl)">✕</button>
            </div>
            <div class="mt-2 text-sm text-slate-200 truncate">{{ pl.name }}</div>
            <div class="text-xs text-slate-500">{{ pl.count }} 首</div>
          </div>
        </div>
      </section>

      <!-- 列表 -->
      <div v-if="!data?.songs?.length" class="tc-card p-8 text-center text-sm text-slate-600">
        {{ localKw ? '本地没有匹配的曲目' : '曲库为空，点击「扫描」建立索引' }}
      </div>

      <template v-else>
        <div class="tc-card overflow-hidden divide-y divide-ink-800">
          <div v-for="(s, i) in data.songs" :key="s.id"
            class="px-2 sm:px-4 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group cursor-pointer"
            @click="openDetail(s)">
            <div class="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-ink-700 flex items-center justify-center relative">
              <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <span v-else class="text-slate-500 text-sm font-medium">{{ initial(s) }}</span>
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white text-sm" title="播放" @click.stop="play(s, i)">▶</button>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-slate-200 truncate" :class="{ 'text-neon-soft': isCurrent(s) }">{{ s.title }}</div>
              <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-slate-600 truncate hidden md:inline max-w-[150px] text-xs">{{ s.album }}</span>
            <span class="font-mono text-[10px] text-slate-700 shrink-0 hidden lg:inline">{{ ext(s.filePath) }}</span>
            <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]" title="加入队列" @click.stop="addOne(s)">＋</button>
            <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]" title="加入歌单" @click.stop="openPick(s)">⤓</button>
            <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70 hover:text-rose-400 text-xs" :disabled="deletingId===s.id" title="移入回收站" @click.stop="remove(s)">
              <span>{{ deletingId===s.id ? '…' : '✕' }}</span>
            </button>
          </div>
        </div>

        <!-- 分页 -->
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="text-slate-600 text-xs">第 {{ offset + 1 }} – {{ Math.min(offset + PAGE, data.total) }} 条</span>
          <div class="flex gap-2">
            <button class="tc-btn text-xs" :disabled="offset===0" @click="page(-1)">上一页</button>
            <button class="tc-btn text-xs" :disabled="offset + PAGE >= data.total" @click="page(1)">下一页</button>
          </div>
        </div>
      </template>
    </template>

    <!-- ============ 歌曲详情 / 刮削弹窗 ============ -->
    <div v-if="detail" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="detail = null">
      <div class="tc-card w-full max-w-md p-5 space-y-4">
        <div class="flex items-start gap-4">
          <div class="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-ink-800 border border-ink-700 flex items-center justify-center">
            <img v-if="detail.cover" :src="`/cover/${detail.cover}`" class="w-full h-full object-cover" />
            <span v-else class="text-2xl text-slate-700">♫</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-base text-slate-100 truncate">{{ detail.title }}</div>
            <div class="text-sm text-slate-500 truncate">{{ detail.artist || '未知歌手' }}</div>
            <div class="text-xs text-slate-600 truncate mt-1">专辑：{{ detail.album || '—' }}</div>
            <div class="text-xs text-slate-600 truncate">时长：{{ detail.duration ? fmtTime(detail.duration) : '—' }}</div>
          </div>
          <button class="tc-icon-btn w-7 h-7 shrink-0" @click="detail = null">✕</button>
        </div>

        <div class="text-[11px] text-slate-600 font-mono truncate bg-ink-800/60 rounded px-2 py-1.5">
          路径：{{ detail.filePath }}
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="tc-btn-primary text-xs" @click="playDetail">播放</button>
          <button class="tc-btn text-xs" :disabled="scraping" @click="scrapeDetail">
            {{ scraping ? '刮削中…' : '重新刮削这首' }}
          </button>
          <button class="tc-btn text-xs" @click="openPick(detail)">加入歌单</button>
          <button class="tc-btn text-xs text-rose-400" :disabled="deletingId===detail.id" @click="remove(detail)">移入回收站</button>
        </div>

        <div v-if="scrapeMsg" class="text-xs rounded px-2.5 py-1.5" :class="scrapeMsg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'">
          {{ scrapeMsg.text }}
        </div>
      </div>
    </div>

    <!-- 加入歌单：选择浮层（与主页共用逻辑） -->
    <div v-if="pickSong" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="pickSong = null">
      <div class="tc-card w-full max-w-sm p-4 space-y-3">
        <div class="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>加入歌单：{{ pickSong.title }}</span>
          <button class="tc-icon-btn w-6 h-6" @click="pickSong = null">✕</button>
        </div>
        <div v-if="!playlists.length" class="text-xs text-slate-600 py-2">还没有歌单，可点下方「新建歌单并加入」。</div>
        <div v-else class="max-h-[50vh] overflow-y-auto space-y-1">
          <button v-for="pl in playlists" :key="pl.id" class="w-full text-left px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-ink-800"
            @click="addToPlaylist(pl)">{{ pl.name }} <span class="text-slate-600 text-[11px]">（{{ pl.count }}）</span></button>
        </div>
        <button class="tc-btn-primary w-full text-xs" @click="createAndAdd">新建歌单并加入</button>
      </div>
    </div>

    <!-- ============ 歌单详情浮层 ============ -->
    <div v-if="activePlaylist" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      @click.self="activePlaylist = null">
      <div class="w-full sm:max-w-lg max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl
                  border border-ink-700 bg-ink-900 overflow-hidden">
        <div class="px-4 py-3 border-b border-ink-700 flex items-center gap-3">
          <div class="w-10 h-10 rounded-md overflow-hidden bg-ink-800 shrink-0 flex items-center justify-center">
            <img v-if="activePlaylist.cover" :src="`/cover/${activePlaylist.cover}`" class="w-full h-full object-cover" />
            <span v-else class="text-slate-600">♫</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-slate-100 truncate">{{ activePlaylist.name }}</div>
            <div class="text-xs text-slate-500">{{ activeTracks.length }} 首</div>
          </div>
          <button class="tc-btn text-xs" :disabled="!activeTracks.length" @click="playPlaylist(activePlaylist)">▶ 播放</button>
          <button class="tc-icon-btn w-7 h-7" @click="activePlaylist = null">✕</button>
        </div>

        <div class="flex-1 overflow-y-auto divide-y divide-ink-800">
          <div v-if="!activeTracks.length" class="px-4 py-8 text-center text-xs text-slate-600">
            歌单还是空的，在曲库列表上点「⤓ 加入歌单」
          </div>
          <div v-for="(s, i) in activeTracks" :key="s.id"
            class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-ink-800/60 group">
            <span class="w-5 shrink-0 text-center font-mono text-xs"
              :class="isCurrent(s) ? 'text-neon' : 'text-slate-700'">{{ i + 1 }}</span>
            <div class="w-8 h-8 shrink-0 rounded overflow-hidden bg-ink-800 flex items-center justify-center">
              <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate" :class="isCurrent(s) ? 'text-neon-soft' : 'text-slate-200'">{{ s.title }}</div>
              <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <button class="tc-icon-btn w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
              title="播放" @click="playTrackAt(activePlaylist, i)">▶</button>
            <button class="tc-icon-btn w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-rose-400/70"
              title="移出歌单" @click="removeTrack(activePlaylist, s)">✕</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="message" class="tc-card p-3 text-sm" :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer, fmtTime } from '../composables/usePlayer.js';
import OnlineSearch from '../components/OnlineSearch.vue';

const PAGE = 50;
const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);

const onlineKwInput = ref('');
const onlineKw = ref('');
const onlineSearching = ref(false);

// 本地搜索（右上角小框，独立于全网搜索）
const localKw = ref('');
let localTimer = null;

const data = ref(null);
const stats = ref(null);
const offset = ref(0);
const scanning = ref(false);
const auditing = ref(false);
const backfilling = ref(false);
const missingCount = ref(0);
const pruning = ref(false);
const auditResult = ref(null);
const backfillResult = ref(null);
const deletingId = ref(null);
const message = ref(null);

const detail = ref(null);
const scraping = ref(false);
const scrapeMsg = ref(null);

const pickSong = ref(null);
const playlists = ref([]);
/** 歌单详情浮层 */
const activePlaylist = ref(null);
const activeTracks = ref([]);

function ext(p) { const m = /\.([^.]+)$/.exec(p || ''); return m ? m[1].toUpperCase() : ''; }
function initial(s) { const t = String(s.title || '').trim(); return t ? t[0].toUpperCase() : '♪'; }
function isCurrent(s) { return cur.value && cur.value.filePath === s.filePath; }

async function doOnlineSearch() {
  const k = onlineKwInput.value.trim();
  if (!k) return;
  onlineSearching.value = true; onlineKw.value = k;
  await new Promise(r => setTimeout(r, 30));
  onlineSearching.value = false;
}

async function load() {
  data.value = await api.library(PAGE, offset.value, localKw.value);
}
async function loadStats() { stats.value = await api.libraryStats(); }
async function loadPlaylists() { const r = await api.playlists(); playlists.value = (r && r.playlists) || []; }

function onLocalInput() {
  clearTimeout(localTimer);
  localTimer = setTimeout(() => { offset.value = 0; load(); }, 250);
}

function page(dir) { offset.value = Math.max(0, offset.value + dir * PAGE); load(); }

// ---------- 歌单（归曲库） ----------
async function createPlaylist() {
  const name = prompt('歌单名称', '新歌单');
  if (name === null) return;
  const r = await api.playlistCreate(name.trim() || '新歌单');
  if (r && r.ok) { await loadPlaylists(); message.value = { ok: true, text: '已新建歌单' }; }
  else message.value = { ok: false, text: (r && r.error) || '新建失败' };
}

async function delPlaylist(pl) {
  if (!confirm(`删除歌单「${pl.name}」？`)) return;
  const r = await api.playlistDelete(pl.id);
  if (r && r.ok) {
    playlists.value = playlists.value.filter(p => p.id !== pl.id);
    if (activePlaylist.value?.id === pl.id) activePlaylist.value = null;
  } else message.value = { ok: false, text: (r && r.error) || '删除失败' };
}

async function openPlaylist(pl) {
  const r = await api.playlistGet(pl.id);
  activeTracks.value = (r && r.tracks) || [];
  activePlaylist.value = pl;
}

async function playPlaylist(pl) {
  message.value = null;
  try {
    const r = await api.playlistPlay(pl.id);
    if (r && r.ok) await player.refresh();
    else message.value = { ok: false, text: (r && r.error) || '歌单为空' };
  } catch (e) { message.value = { ok: false, text: '播放失败：' + e }; }
}

async function playTrackAt(pl, index) {
  const r = await api.playlistPlay(pl.id);
  if (r && r.ok) await player.jump(Math.min(index, player.state.queue.length - 1));
}

async function removeTrack(pl, s) {
  const r = await api.playlistRemove(pl.id, s.id);
  if (r && r.ok) {
    const g = await api.playlistGet(pl.id);
    activeTracks.value = (g && g.tracks) || [];
    await loadPlaylists();
  }
}

function play(song, index) {
  const songs = (data.value?.songs || []).map(s => ({
    title: s.title, artist: s.artist, album: s.album, filePath: s.filePath, platform: 'local', songId: String(s.id),
  }));
  const at = Math.max(0, index ?? songs.findIndex(s => s.filePath === song.filePath));
  player.playList(songs, at);
}

async function addOne(song) {
  await player.append([{ title: song.title, artist: song.artist, album: song.album, filePath: song.filePath, platform: 'local', songId: String(song.id) }]);
  message.value = { ok: true, text: `已添加到队列：${song.title}` };
}

async function scan() {
  scanning.value = true; message.value = null;
  try { const r = await api.scan(); await Promise.all([load(), loadStats(), checkMissing()]); message.value = { ok: true, text: `扫描完成，新增 ${r.added ?? 0} 首，共 ${r.total ?? 0} 首` }; }
  finally { scanning.value = false; }
}

// ---------- 失效曲目（磁盘上已被外部删除） ----------
async function checkMissing() {
  try { const r = await api.libraryMissing(); missingCount.value = r?.missing ?? 0; } catch { missingCount.value = 0; }
}
async function prune() {
  if (!confirm(`清理 ${missingCount.value} 首失效曲目？\n仅删除索引条目（并移出相关歌单），不会动磁盘文件。`)) return;
  pruning.value = true; message.value = null;
  try {
    const r = await api.libraryPrune();
    message.value = r?.ok
      ? { ok: true, text: r.message || `已清理 ${r.removed} 首` }
      : { ok: false, text: r?.error || '清理失败' };
    await Promise.all([load(), loadStats(), checkMissing()]);
  } finally { pruning.value = false; }
}

async function audit() { auditing.value = true; try { auditResult.value = await api.audit(200); } finally { auditing.value = false; } }
async function backfill() { backfilling.value = true; message.value = null; try { backfillResult.value = await api.backfill(20); await load(); } finally { backfilling.value = false; } }

async function remove(song) {
  if (!confirm(`将「${song.title}」移入回收站？\n文件不会立即删除，可在 /data/_trash 找回。`)) return;
  deletingId.value = song.id; message.value = null;
  try {
    const r = await api.libraryDelete(song.filePath);
    message.value = r.ok ? { ok: true, text: `已移入回收站：${song.title}` } : { ok: false, text: r.error || '删除失败' };
    if (r.ok) { await Promise.all([load(), loadStats()]); if (detail.value?.id === song.id) detail.value = null; }
  } finally { deletingId.value = null; }
}

// ---------- 详情 / 刮削 ----------
function openDetail(s) { detail.value = s; scrapeMsg.value = null; }
async function playDetail() { const i = (data.value?.songs || []).findIndex(s => s.id === detail.value.id); play(detail.value, i); }
async function scrapeDetail() {
  if (!detail.value) return;
  scraping.value = true; scrapeMsg.value = null;
  try {
    const r = await api.scrapeSong(detail.value.filePath);
    if (r && r.ok) {
      const parts = [];
      if (r.tags?.written?.length) parts.push(`标签 ${r.tags.written.join('/')}`);
      if (r.cover) parts.push('封面已写');
      if (r.lyrics) parts.push('歌词已写');
      scrapeMsg.value = { ok: true, text: parts.length ? `刮削完成：${parts.join('，')}` : '刮削完成（无需更新）' };
      await Promise.all([load(), loadStats()]);
      const fresh = (data.value?.songs || []).find(s => s.id === detail.value.id);
      if (fresh) detail.value = fresh;
    } else scrapeMsg.value = { ok: false, text: (r && r.error) || '刮削失败' };
  } catch (e) { scrapeMsg.value = { ok: false, text: '刮削失败：' + e }; }
  finally { scraping.value = false; }
}

// ---------- 加入歌单 ----------
function openPick(song) { pickSong.value = song; }
async function addToPlaylist(pl) {
  const s = pickSong.value; if (!s) return;
  const r = await api.playlistAdd(pl.id, s.id);
  if (r && r.ok) { message.value = { ok: true, text: `已加入「${pl.name}」` }; pickSong.value = null; await loadPlaylists(); }
  else message.value = { ok: false, text: (r && r.error) || '加入失败' };
}
async function createAndAdd() {
  const s = pickSong.value; if (!s) return;
  const name = prompt('新歌单名称', '新歌单');
  if (name === null) return;
  const c = await api.playlistCreate(name.trim() || '新歌单');
  if (c && c.ok) { await api.playlistAdd(c.id, s.id); pickSong.value = null; await loadPlaylists(); message.value = { ok: true, text: '已新建并加入歌单' }; }
}

onMounted(() => { load(); loadStats(); loadPlaylists(); checkMissing(); });
</script>
