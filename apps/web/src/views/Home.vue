<template>
  <div class="space-y-5">
    <!-- ============ 顶部：搜索 + 显示方式 ============ -->
    <div class="flex gap-2 items-center">
      <div class="relative flex-1">
        <Icon name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
        <input v-model="localKw" class="tc-input pl-9 pr-9" placeholder="搜索本地歌曲 / 歌手 / 专辑" />
        <button v-if="localKw" class="tc-icon-btn tc-icon-btn-sm absolute right-2 top-1/2 -translate-y-1/2"
          title="清空" @click="localKw = ''">
          <Icon name="x" :size="13" />
        </button>
      </div>

      <!-- 显示方式：列表 / 小图 / 中图 -->
      <div class="inline-flex rounded-md border border-line overflow-hidden shrink-0 bg-white/[0.02]">
        <button v-for="v in VIEWS" :key="v.id"
          class="px-2.5 py-1.5 transition-colors"
          :class="view === v.id ? 'bg-accent-weak text-accent' : 'text-fg-subtle hover:text-fg'"
          :title="v.label" @click="setView(v.id)">
          <Icon :name="v.icon" :size="15" />
        </button>
      </div>
    </div>

    <!-- 统计行 -->
    <div class="flex items-center gap-3 text-xs text-fg-subtle">
      <span class="tc-num">
        {{ localKw ? `匹配 ${filtered.length} / ${total}` : `${total} 首` }}
      </span>
      <button class="tc-btn-ghost text-xs -ml-1" :disabled="loading" @click="load">
        <Icon name="refresh" :size="13" />
        <span>刷新</span>
      </button>
    </div>

    <!-- ============ 歌单（跟随主流方案放在首页；搜索时让位给结果） ============ -->
    <section v-if="!localKw && home.playlists.length" class="space-y-2">
      <h3 class="tc-section-title">歌单</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div v-for="pl in home.playlists" :key="pl.id"
          class="group cursor-pointer" @click="playPlaylist(pl)">
          <div class="relative tc-cover-art">
            <img v-if="pl.cover" :src="`/cover/${pl.cover}`" class="w-full h-full object-cover" loading="lazy" />
            <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
              <Icon name="list" :size="28" />
            </div>
            <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
              :title="`播放 ${pl.name}`">
              <span class="w-10 h-10 rounded-full bg-accent text-fg-inverse flex items-center justify-center">
                <Icon name="play" :size="17" />
              </span>
            </button>
          </div>
          <div class="mt-1.5 text-sm text-fg truncate">{{ pl.name }}</div>
          <div class="text-[11px] text-fg-subtle tc-num">{{ pl.count }} 首</div>
        </div>
      </div>
    </section>

    <!-- 在线推荐已按用户要求移到曲库页（Library.vue） -->

    <!--
      「最近入库」已取消（用户要求）：它与本地曲库列表完全重复，
      首页放一份、曲库页再放一份，等于把同样的歌摆了两遍。
      在线推荐改放曲库页（见 Library.vue）。
    -->

    <!--
      「专辑 / 歌手」分类已按用户要求取消：
      它们只是把本地歌曲换个角度再摆一遍，反而挡住了本地歌曲本身。
    -->


    <!-- ============ 状态区 ============ -->
    <div v-if="loading && !songs.length" class="grid gap-3"
      :class="view === 'list' ? '' : 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'">
      <div v-for="i in 8" :key="i" class="tc-skeleton" :class="view === 'list' ? 'h-14' : 'aspect-square'"></div>
    </div>

    <div v-else-if="!songs.length" class="tc-empty">
      <div class="tc-empty-icon"><Icon name="music" :size="22" /></div>
      <div class="tc-empty-title">曲库还没有歌曲</div>
      <div class="tc-empty-desc">去「曲库」点「扫描」，或用云端搜索入库</div>
    </div>

    <div v-else-if="!filtered.length" class="tc-empty">
      <div class="tc-empty-icon"><Icon name="search" :size="22" /></div>
      <div class="tc-empty-title">没有匹配「{{ localKw }}」的歌曲</div>
      <div class="tc-empty-desc">找网络歌曲请去「曲库」搜索</div>
    </div>

    <!-- ============ 列表视图 ============ -->
    <div v-else-if="view === 'list'" class="tc-panel divide-y divide-line">
      <div v-for="s in filtered" :key="s.id"
        class="tc-row group"
        :class="{ 'tc-row-active': isCurrent(s) }"
        @click="playSong(s)">
        <div class="relative tc-cover tc-cover-sm">
          <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
          <span v-else class="text-[11px] font-medium text-fg-muted">{{ initial(s) }}</span>
          <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white">
            <Icon name="play" :size="14" />
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-fg truncate" :class="{ 'text-accent': isCurrent(s) }">{{ s.title }}</div>
          <div class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
        </div>
        <span class="text-fg-subtle truncate hidden md:inline max-w-[160px] text-xs">{{ s.album }}</span>
        <span class="text-[11px] tc-num text-fg-subtle shrink-0">{{ fmtDur(s.duration) }}</span>
        <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100"
          title="加入队列" @click.stop="appendSong(s)">
          <Icon name="plus" :size="14" />
        </button>
      </div>
    </div>

    <!-- ============ 网格视图（小图 / 中图） ============ -->
    <div v-else :class="view === 'grid-sm'
      ? 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3'
      : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4'">
      <div v-for="s in filtered" :key="s.id" class="group cursor-pointer" @click="playSong(s)">
        <div class="relative tc-cover-art">
          <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
          <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle"
            :class="view === 'grid-sm' ? 'text-xl' : 'text-3xl'">
            <Icon name="music" :size="view === 'grid-sm' ? 22 : 34" />
          </div>
          <!-- hover 播放按钮：整块覆盖，点击任何位置都能播 -->
          <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
            :title="`播放 ${s.title}`">
            <span class="rounded-full bg-accent text-fg-inverse flex items-center justify-center"
              :class="view === 'grid-sm' ? 'w-8 h-8' : 'w-11 h-11'">
              <Icon name="play" :size="view === 'grid-sm' ? 14 : 18" />
            </span>
          </button>
        </div>
        <div class="mt-1.5 truncate" :class="view === 'grid-sm' ? 'text-[11px] text-fg-muted' : 'text-sm text-fg'"
          :title="s.title">{{ s.title }}</div>
        <div v-if="view !== 'grid-sm'" class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
      </div>
    </div>

    <!-- ============ 本地歌曲管理（按用户要求从曲库页迁来，放在本地列表后方）============
         分工：主页负责「显示 + 处理本地歌曲」，曲库负责「推荐 + 下载」。 -->
    <template v-if="!localKw">
      <!-- 操作区 -->
      <div class="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 class="tc-section-title">本地曲库管理</h3>
          <p class="text-xs text-fg-subtle mt-0.5">
            共 <span class="tc-num text-accent">{{ total }}</span> 首 · 云端搜歌与推荐请到「曲库」
          </p>
        </div>
        <div class="flex gap-2 flex-wrap items-center">
          <button class="tc-btn text-xs" :disabled="scanning" @click="scan">
            <Icon name="scan" :size="14" />
            <span>{{ scanning ? '扫描中…' : '扫描' }}</span>
          </button>
          <button class="tc-btn text-xs" :disabled="auditing" @click="audit">
            <Icon name="info" :size="14" />
            <span>{{ auditing ? '审计中…' : '元数据审计' }}</span>
          </button>
          <button class="tc-btn text-xs" :disabled="backfilling" @click="backfill">
            <Icon name="pencil" :size="14" />
            <span>{{ backfilling ? '补全中…' : '补全标签' }}</span>
          </button>
        </div>
      </div>

      <!-- 失效曲目：文件被外部删除，索引里仍有残留 -->
      <div v-if="missingCount > 0"
        class="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06]">
        <Icon name="alert" :size="16" class="text-amber-300 shrink-0" />
        <span class="text-sm text-amber-300">
          有 <b class="tc-num">{{ missingCount }}</b> 首曲目在磁盘上已不存在，仍残留在曲库中。
        </span>
        <button class="tc-btn text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          :disabled="pruning" @click="prune">
          {{ pruning ? '清理中…' : '清理失效曲目' }}
        </button>
        <button class="tc-icon-btn tc-icon-btn-sm" title="重新检查" @click="checkMissing">
          <Icon name="refresh" :size="14" />
        </button>
      </div>

      <!-- 统计卡 -->
      <div v-if="stats" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="tc-card p-3">
          <div class="text-xs text-fg-muted mb-0.5">曲目</div>
          <div class="text-lg font-semibold tc-num text-fg">{{ stats.total }}</div>
        </div>
        <div class="tc-card p-3">
          <div class="text-xs text-fg-muted mb-0.5">歌手</div>
          <div class="text-lg font-semibold tc-num text-fg">{{ stats.artists }}</div>
        </div>
        <div class="tc-card p-3">
          <div class="text-xs text-fg-muted mb-0.5">专辑</div>
          <div class="text-lg font-semibold tc-num text-fg">{{ stats.albums }}</div>
        </div>
        <div class="tc-card p-3">
          <div class="text-xs text-fg-muted mb-0.5">今日新增</div>
          <div class="text-lg font-semibold tc-num" :class="stats.addedToday>0?'text-accent':'text-fg'">
            {{ stats.addedToday }}
          </div>
        </div>
      </div>

      <!-- 审计 / 补全结果 -->
      <div v-if="auditResult" class="tc-card p-3 text-sm flex flex-wrap gap-4">
        <span class="text-fg-muted">检查 <b class="text-fg tc-num">{{ auditResult.checked }}</b> 首</span>
        <span class="text-fg-muted">缺封面 <b class="text-amber-400 tc-num">{{ auditResult.missingCover }}</b></span>
        <span class="text-fg-muted">缺元数据 <b class="text-amber-400 tc-num">{{ auditResult.missingMeta }}</b></span>
        <span class="text-fg-muted">缺歌词 <b class="text-amber-400 tc-num">{{ auditResult.missingLyrics ?? 0 }}</b></span>
      </div>
      <div v-if="backfillResult" class="tc-card p-3 text-sm flex flex-wrap gap-4">
        <span class="text-fg-muted">扫描 <b class="text-fg tc-num">{{ backfillResult.scanned }}</b></span>
        <span class="text-fg-muted">补全 <b class="text-emerald-400 tc-num">{{ backfillResult.fixed }}</b></span>
        <span class="text-fg-muted">失败 <b class="text-fg-subtle tc-num">{{ backfillResult.failed }}</b></span>
      </div>
    </template>

    <!-- 轻提示 -->
    <div v-if="message" class="tc-alert" :class="message.ok ? 'tc-alert-ok' : 'tc-alert-warn'">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="15" class="mt-0.5" />
      <span>{{ message.text }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer, fmtTime } from '../composables/usePlayer.js';
import Icon from '../components/Icon.vue';

const player = usePlayer();
const cur = computed(() => player.current.value);

const localKw = ref('');
const songs = ref([]);
const total = ref(0);
const loading = ref(false);
const message = ref(null);

/** 首页聚合数据：歌单（专辑/歌手分类与在线推荐已按用户要求移除） */
const home = ref({ playlists: [] });
const homeLoading = ref(false);

async function loadHome() {
  homeLoading.value = true;
  try {
    const r = await api.home();
    if (r) home.value = { playlists: r.playlists || [] };
  } catch { /* 首页增量数据失败不影响本地列表，静默 */ }
  finally { homeLoading.value = false; }
}

// ---------- 本地曲库管理（按用户要求从曲库页迁来）----------
const stats = ref(null);
const scanning = ref(false);
const auditing = ref(false);
const backfilling = ref(false);
const missingCount = ref(0);
const pruning = ref(false);
const auditResult = ref(null);
const backfillResult = ref(null);

async function loadStats() { try { stats.value = await api.libraryStats(); } catch { stats.value = null; } }

async function scan() {
  scanning.value = true; message.value = null;
  try {
    const r = await api.scan();
    await Promise.all([load(), loadStats(), checkMissing()]);
    message.value = { ok: true, text: `扫描完成，新增 ${r.added ?? 0} 首，共 ${r.total ?? 0} 首` };
  } finally { scanning.value = false; }
}

/** 失效曲目：磁盘上已被外部删除，索引里仍有残留 */
async function checkMissing() {
  try { const r = await api.libraryMissing(); missingCount.value = r?.missing ?? 0; }
  catch { missingCount.value = 0; }
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
async function backfill() {
  backfilling.value = true; message.value = null;
  try { backfillResult.value = await api.backfill(20); await load(); }
  finally { backfilling.value = false; }
}


/** 显示方式：列表 / 小图 / 中图 */
const VIEWS = [
  { id: 'list',    label: '列表', icon: 'list' },
  { id: 'grid-sm', label: '小图', icon: 'gridSm' },
  { id: 'grid-md', label: '中图', icon: 'grid' },
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

/** 首页歌单：整张播放 */
async function playPlaylist(pl) {
  try {
    const r = await api.playlistPlay(pl.id);
    if (r && r.ok) {
      // 服务端已持有队列，前端刷新一次即可对齐
      await player.refresh();
    } else {
      message.value = { ok: false, text: '播放失败：' + ((r && r.error) || '未知错误') };
      setTimeout(() => { message.value = null; }, 2000);
    }
  } catch (e) {
    message.value = { ok: false, text: '播放失败：' + e };
    setTimeout(() => { message.value = null; }, 2000);
  }
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

onMounted(() => { load(); loadHome(); loadStats(); checkMissing(); });
</script>
