<template>
  <div class="space-y-5">
    <!-- ============ 头部 ============ -->
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">音乐库</h1>
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

    <!-- ============ 统一搜索（本地 / 在线） ============ -->
    <!--
      原来曲库页只放一个「本地搜索」输入框，和顶栏的全局搜索、在线搜索页三处并存，
      入口冗余。这里收敛成一个搜索条：左段切「本地 / 在线」，共用同一个输入框。
      在线走 /api/search（联网搜歌），为后续接入预留。
    -->
    <div class="flex gap-2 flex-wrap">
      <div class="flex shrink-0 rounded-lg overflow-hidden border border-ink-700">
        <button v-for="m in SEARCH_MODES" :key="m.id"
          class="px-3 py-2 text-xs transition-colors"
          :class="mode === m.id
            ? 'bg-neon-dim text-ink-950 font-medium'
            : 'bg-ink-800 text-slate-400 hover:text-slate-200'"
          @click="switchMode(m.id)">
          {{ m.label }}
        </button>
      </div>
      <input v-model="keyword" class="tc-input flex-1 min-w-[160px]"
        :placeholder="mode === 'local'
          ? '搜索本地歌名 / 歌手 / 专辑，回车确认'
          : '联网搜歌（走音源，回车确认）'"
        @keyup.enter="applySearch" />
      <button class="tc-btn-primary shrink-0" :disabled="onlineLoading" @click="applySearch">
        {{ mode === 'online' && onlineLoading ? '搜索中…' : '搜索' }}
      </button>
      <button v-if="data?.keyword || lastKeyword" class="tc-btn shrink-0" @click="clearSearch">清空</button>
    </div>

    <!-- 在线模式的说明条 -->
    <div v-if="mode === 'online'" class="tc-card p-3 text-xs text-slate-500 flex items-start gap-2">
      <span class="text-amber-400 shrink-0">ⓘ</span>
      <span>
        联网搜索走音源（<code class="text-slate-400">/api/search</code>），结果可直接试听、入队。
        当前为<strong class="text-slate-300">预留接入</strong>：取链依赖音源健康度，
        若全部失败请到「音源」页检查。
      </span>
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

    <!-- ============ 主体：左曲库 / 右正在播放（已整合） ============ -->
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">

      <!-- ---------- 左：列表 ---------- -->
      <div class="space-y-4 min-w-0">

        <!-- 在线结果 -->
        <template v-if="mode === 'online'">
          <div v-if="!onlineSearched" class="tc-card p-8 text-center text-sm text-slate-600">
            输入关键词联网搜歌
          </div>
          <div v-else-if="!onlineTotal" class="tc-card p-8 text-center text-sm text-slate-600">
            没有搜索到「{{ lastKeyword }}」的在线结果
          </div>
          <template v-else>
            <div v-for="(list, plat) in onlineResults" :key="plat">
              <div class="flex items-center gap-2 mb-2">
                <span class="tc-badge text-[10px]">{{ PLAT_LABEL[plat] || String(plat).toUpperCase() }}</span>
                <span class="text-xs text-slate-600">{{ list.length }} 首</span>
              </div>
              <div class="tc-card overflow-hidden divide-y divide-ink-800 mb-3">
                <div v-for="(s, i) in list" :key="s.id || i"
                  class="px-3 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group cursor-pointer"
                  @click="playOnline(list, i)">
                  <div class="min-w-0 flex-1">
                    <div class="text-slate-200 truncate">{{ s.title }}</div>
                    <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
                  </div>
                  <span class="text-slate-600 truncate hidden md:inline max-w-[130px] text-xs">{{ s.album }}</span>
                  <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
                    title="添加到队列" @click.stop="addOnline(s)">＋</button>
                </div>
              </div>
            </div>
          </template>
        </template>

        <!-- 本地曲库 -->
        <template v-else>
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
        </template>
      </div>

      <!-- ---------- 右：正在播放（整合进曲库，不再单开一页） ---------- -->
      <aside class="tc-card overflow-hidden lg:sticky lg:top-0">
        <div class="px-3 py-2.5 border-b border-ink-700 flex items-center gap-2">
          <span class="text-sm font-medium text-slate-300">正在播放</span>
          <span v-if="state.queue.length" class="text-[11px] text-slate-600 font-mono">
            {{ state.index + 1 }}/{{ state.queue.length }}
          </span>
          <button class="tc-btn text-xs py-1 px-2 ml-auto" @click="player.clear">清空</button>
        </div>

        <!-- 空态 -->
        <div v-if="!cur" class="p-8 text-center space-y-2">
          <div class="text-3xl text-slate-700">♫</div>
          <div class="text-xs text-slate-600">在左侧曲库点一首歌开始播放</div>
        </div>

        <template v-else>
          <!-- 当前曲目 -->
          <div class="p-3 flex items-center gap-3">
            <div class="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-ink-800
                        border border-ink-700 flex items-center justify-center">
              <img v-if="player.coverUrl.value" :src="player.coverUrl.value"
                   class="w-full h-full object-cover" alt="" />
              <span v-else class="text-neon-soft text-xl">♫</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm text-slate-200 truncate">{{ cur.title }}</div>
              <div class="text-xs text-slate-500 truncate mt-0.5">{{ cur.artist }}</div>
              <div class="flex items-center gap-1.5 mt-1.5">
                <span class="tc-badge text-[10px]">
                  {{ cur.origin === 'local' ? '本地' : (cur.platform || '').toUpperCase() }}
                </span>
                <span v-if="state.loading" class="text-[10px] text-amber-400">缓冲中…</span>
              </div>
            </div>
          </div>

          <!-- 进度 -->
          <div class="px-3 flex items-center gap-2">
            <span class="text-[10px] font-mono text-slate-600 w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
            <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime" @input="e => player.seek(Number(e.target.value))" />
            <span class="text-[10px] font-mono text-slate-600 w-9">{{ fmtTime(state.duration) }}</span>
          </div>

          <!-- 控制 -->
          <div class="px-3 py-2 flex items-center justify-center gap-2">
            <button class="tc-icon-btn w-8 h-8" :title="REPEAT_META[state.repeat].label"
              @click="player.cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
            <button class="tc-icon-btn w-8 h-8" title="上一首" @click="player.prev">⏮</button>
            <button class="w-10 h-10 rounded-full bg-gradient-to-br from-neon-dim to-neon
                           text-ink-950 flex items-center justify-center
                           hover:shadow-glow transition-shadow"
              @click="player.toggle">{{ state.playing ? '⏸' : '▶' }}</button>
            <button class="tc-icon-btn w-8 h-8" title="下一首" @click="player.next">⏭</button>
            <button class="tc-icon-btn w-8 h-8" title="全屏歌词" @click="player.toggleExpand">⤢</button>
          </div>

          <div v-if="state.error" class="px-3 pb-2 text-[11px] text-amber-400">{{ state.error }}</div>

          <!-- 队列（就地可见，不必再跳去单独的播放页） -->
          <div class="border-t border-ink-700">
            <div class="px-3 py-2 text-xs text-slate-500">播放队列</div>
            <div class="max-h-[280px] overflow-y-auto divide-y divide-ink-800">
              <div v-for="(s, i) in state.queue" :key="s.uid"
                class="px-3 py-2 flex items-center gap-2 text-xs cursor-pointer group"
                :class="i === state.index ? 'bg-ink-800' : 'hover:bg-ink-800/50'"
                @click="player.jump(i)">
                <span class="w-4 shrink-0 text-center font-mono text-[10px]"
                      :class="i === state.index ? 'text-neon' : 'text-slate-700'">
                  <span v-if="i === state.index && state.playing" class="tc-bars inline-flex">
                    <i></i><i></i><i></i>
                  </span>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="truncate flex-1" :class="i === state.index ? 'text-neon-soft' : 'text-slate-400'">
                  {{ s.title }}
                </span>
                <button class="tc-icon-btn w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100
                               text-rose-400/70 hover:text-rose-400 text-[10px]"
                  title="移除" @click.stop="player.removeAt(s.uid)">✕</button>
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>

    <div v-if="message" class="tc-card p-3 text-sm" :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';

const PAGE = 50;
const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);

/** 搜索模式：本地曲库 / 联网搜索（为联网搜歌预留） */
const SEARCH_MODES = [
  { id: 'local', label: '本地' },
  { id: 'online', label: '在线' },
];

/** 平台代码 → 展示名 */
const PLAT_LABEL = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };

const mode = ref('local');
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

// 在线搜索
const onlineResults = ref({});
const onlineLoading = ref(false);
const onlineSearched = ref(false);
const lastKeyword = ref('');
const onlineTotal = computed(() =>
  Object.values(onlineResults.value).reduce((n, l) => n + (l?.length || 0), 0)
);

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

/** 切搜索模式：清空条件，避免两种结果混在一起 */
function switchMode(m) {
  if (mode.value === m) return;
  mode.value = m;
  keyword.value = '';
  offset.value = 0;
  lastKeyword.value = '';
  onlineResults.value = {};
  onlineSearched.value = false;
  message.value = null;
  if (m === 'local') load();
}

function applySearch() {
  if (!keyword.value.trim()) return;
  offset.value = 0;
  if (mode.value === 'online') doOnlineSearch();
  else load();
}

/** 联网搜歌：走 /api/search（音源聚合） */
async function doOnlineSearch() {
  const kw = keyword.value.trim();
  onlineLoading.value = true;
  message.value = null;
  onlineSearched.value = true;
  try {
    const r = await api.search(kw);
    if (r && r.ok) {
      onlineResults.value = r.platforms || {};
      lastKeyword.value = kw;
      if (!onlineTotal.value) {
        message.value = { ok: false, text: '没有搜到结果，可能是音源未就绪（到「音源」页检查）' };
      }
    } else {
      onlineResults.value = {};
      message.value = { ok: false, text: (r && r.error) || '搜索失败' };
    }
  } catch (e) {
    message.value = { ok: false, text: '搜索失败：' + e };
  } finally {
    onlineLoading.value = false;
  }
}

function clearSearch() {
  keyword.value = '';
  lastKeyword.value = '';
  offset.value = 0;
  onlineResults.value = {};
  onlineSearched.value = false;
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

/** 在线结果：用该平台整组结果建队列，从这首开始 */
async function playOnline(list, index) {
  message.value = null;
  try {
    const r = await player.playList(list, index);
    if (!r || r.ok === false) {
      message.value = { ok: false, text: (r && r.error) || '这首歌暂时取不到可播放地址' };
    } else if (!r.playUrl) {
      message.value = { ok: false, text: `「${list[index].title}」取链失败，换一首试试` };
    }
  } catch (e) {
    message.value = { ok: false, text: '播放失败：' + e };
  }
}

async function addOnline(song) {
  await player.append([song]);
  message.value = { ok: true, text: `已添加到队列：${song.title}` };
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
