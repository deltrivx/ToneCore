<template>
  <div class="space-y-5">
    <!-- ============ 顶部：云端搜索（本页只搜云端；搜本地去主页） ============ -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <Icon name="search" :size="15"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
        <input v-model="onlineKwInput" class="tc-input pl-9"
          placeholder="搜索云端歌曲 / 歌手（回车）" @keyup.enter="doOnlineSearch" />
      </div>
      <button class="tc-btn-primary shrink-0" :disabled="onlineSearching" @click="doOnlineSearch">
        <Icon name="search" :size="14" />
        <span>{{ onlineSearching ? '搜索中…' : '云端搜索' }}</span>
      </button>
    </div>

    <!-- 在线结果（内联，不跳页） -->
    <OnlineSearch v-if="onlineKw" :keyword="onlineKw" />

    <!-- ============ 本地曲库（云端搜索结果为空时才显示） ============ -->
    <template v-if="!onlineKw">
      <!-- 头部：标题 + 统计 + 操作 -->
      <div class="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-semibold text-fg">曲库</h2>
          <p class="text-sm text-fg-muted mt-0.5">
            共 <span class="tc-num text-accent">{{ data?.total ?? 0 }}</span> 首
            <span class="text-fg-subtle">· 本地歌曲检索请到「主页」</span>
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
          有 <b class="tc-num">{{ missingCount }}</b> 首曲目在磁盘上已不存在（文件被外部删除），仍残留在曲库中。
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

      <!-- ============ 歌单（歌单归曲库，不再占主页版面） ============ -->
      <section>
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="tc-section-title">歌单</h3>
          <button class="tc-btn-ghost text-xs" @click="createPlaylist">
            <Icon name="plus" :size="14" />
            <span>新建</span>
          </button>
        </div>

        <div v-if="!playlists.length" class="tc-empty">
          <div class="tc-empty-icon"><Icon name="disc" :size="22" /></div>
          <div class="tc-empty-title">还没有歌单</div>
          <div class="tc-empty-desc">在下方曲目上点「加入歌单」，或点右上角新建</div>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div v-for="pl in playlists" :key="pl.id" class="group cursor-pointer" @click="openPlaylist(pl)">
            <div class="relative tc-cover-art">
              <img v-if="pl.cover" :src="`/cover/${pl.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
                <Icon name="disc" :size="30" />
              </div>
              <!-- hover 覆盖层：整块可点播放 -->
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
                title="播放歌单" @click.stop="playPlaylist(pl)">
                <span class="w-11 h-11 rounded-full bg-accent text-fg-inverse flex items-center justify-center">
                  <Icon name="play" :size="18" />
                </span>
              </button>
              <button class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-rose-300/80
                             opacity-0 group-hover:opacity-100 flex items-center justify-center"
                title="删除歌单" @click.stop="delPlaylist(pl)">
                <Icon name="x" :size="13" />
              </button>
            </div>
            <div class="mt-2 text-sm text-fg truncate">{{ pl.name }}</div>
            <div class="text-xs tc-num text-fg-muted">{{ pl.count }} 首</div>
          </div>
        </div>
      </section>

      <!-- ============ 曲目列表 ============ -->
      <div v-if="!data?.songs?.length" class="tc-empty">
        <div class="tc-empty-icon"><Icon name="folder" :size="22" /></div>
        <div class="tc-empty-title">曲库为空</div>
        <div class="tc-empty-desc">点击「扫描」建立索引</div>
      </div>

      <template v-else>
        <div class="tc-panel divide-y divide-line">
          <div v-for="(s, i) in data.songs" :key="s.id" class="tc-row group" @click="openDetail(s)">
            <div class="relative tc-cover tc-cover-sm">
              <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <span v-else class="text-[11px] font-medium text-fg-muted">{{ initial(s) }}</span>
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white"
                title="播放" @click.stop="play(s, i)">
                <Icon name="play" :size="14" />
              </button>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm text-fg truncate" :class="{ 'text-accent': isCurrent(s) }">{{ s.title }}</div>
              <div class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-fg-subtle truncate hidden md:inline max-w-[150px] text-xs">{{ s.album }}</span>
            <span class="tc-num text-[10px] text-fg-subtle shrink-0 hidden lg:inline">{{ ext(s.filePath) }}</span>

            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100"
              title="加入队列" @click.stop="addOne(s)">
              <Icon name="plus" :size="14" />
            </button>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100"
              title="加入歌单" @click.stop="openPick(s)">
              <Icon name="disc" :size="14" />
            </button>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70 hover:text-rose-400"
              :disabled="deletingId===s.id" title="移入回收站" @click.stop="remove(s)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </div>

        <!-- 分页 -->
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="text-fg-subtle text-xs tc-num">
            第 {{ offset + 1 }} – {{ Math.min(offset + PAGE, data.total) }} 条
          </span>
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
          <div class="w-20 h-20 shrink-0 tc-cover rounded-md">
            <img v-if="detail.cover" :src="`/cover/${detail.cover}`" class="w-full h-full object-cover" />
            <Icon v-else name="music" :size="26" class="text-fg-subtle" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-base text-fg truncate">{{ detail.title }}</div>
            <div class="text-sm text-fg-muted truncate">{{ detail.artist || '未知歌手' }}</div>
            <div class="text-xs text-fg-subtle truncate mt-1">专辑：{{ detail.album || '—' }}</div>
            <div class="text-xs text-fg-subtle truncate">时长：{{ detail.duration ? fmtTime(detail.duration) : '—' }}</div>
          </div>
          <button class="tc-icon-btn tc-icon-btn-sm shrink-0" @click="detail = null">
            <Icon name="x" :size="15" />
          </button>
        </div>

        <div class="text-[11px] font-mono text-fg-subtle truncate bg-surface-overlay rounded px-2 py-1.5">
          路径：{{ detail.filePath }}
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="tc-btn-primary text-xs" @click="playDetail">
            <Icon name="play" :size="14" />
            <span>播放</span>
          </button>
          <button class="tc-btn text-xs" :disabled="scraping" @click="scrapeDetail">
            <Icon name="refresh" :size="14" />
            <span>{{ scraping ? '刮削中…' : '重新刮削这首' }}</span>
          </button>
          <button class="tc-btn text-xs" @click="openPick(detail)">
            <Icon name="disc" :size="14" />
            <span>加入歌单</span>
          </button>
          <button class="tc-btn-danger text-xs" :disabled="deletingId===detail.id" @click="remove(detail)">
            <Icon name="trash" :size="14" />
            <span>移入回收站</span>
          </button>
        </div>

        <div v-if="scrapeMsg" class="tc-alert" :class="scrapeMsg.ok ? 'tc-alert-ok' : 'tc-alert-warn'">
          <Icon :name="scrapeMsg.ok ? 'check' : 'alert'" :size="15" class="mt-0.5" />
          <span>{{ scrapeMsg.text }}</span>
        </div>
      </div>
    </div>

    <!-- 加入歌单：选择浮层 -->
    <div v-if="pickSong" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="pickSong = null">
      <div class="tc-card w-full max-w-sm p-4 space-y-3">
        <div class="text-sm font-medium text-fg flex items-center justify-between gap-2">
          <span class="truncate">加入歌单：{{ pickSong.title }}</span>
          <button class="tc-icon-btn tc-icon-btn-sm shrink-0" @click="pickSong = null">
            <Icon name="x" :size="14" />
          </button>
        </div>
        <div v-if="!playlists.length" class="text-xs text-fg-subtle py-2">还没有歌单，可点下方「新建歌单并加入」。</div>
        <div v-else class="max-h-[50vh] overflow-y-auto space-y-1">
          <button v-for="pl in playlists" :key="pl.id"
            class="w-full text-left px-3 py-2 rounded-md text-sm text-fg-muted hover:bg-white/[0.06] hover:text-fg"
            @click="addToPlaylist(pl)">
            {{ pl.name }} <span class="text-fg-subtle text-[11px] tc-num">（{{ pl.count }}）</span>
          </button>
        </div>
        <button class="tc-btn-primary w-full text-xs" @click="createAndAdd">新建歌单并加入</button>
      </div>
    </div>

    <!-- ============ 歌单详情浮层 ============ -->
    <div v-if="activePlaylist" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      @click.self="activePlaylist = null">
      <div class="w-full sm:max-w-lg max-h-[80vh] flex flex-col rounded-t-xl sm:rounded-xl
                  border border-line bg-surface-raised overflow-hidden">
        <div class="px-4 py-3 border-b border-line flex items-center gap-3">
          <div class="w-10 h-10 shrink-0 tc-cover rounded-md">
            <img v-if="activePlaylist.cover" :src="`/cover/${activePlaylist.cover}`" class="w-full h-full object-cover" />
            <Icon v-else name="disc" :size="18" class="text-fg-subtle" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-fg truncate">{{ activePlaylist.name }}</div>
            <div class="text-xs tc-num text-fg-muted">{{ activeTracks.length }} 首</div>
          </div>
          <button class="tc-btn text-xs" :disabled="!activeTracks.length" @click="playPlaylist(activePlaylist)">
            <Icon name="play" :size="13" />
            <span>播放</span>
          </button>
          <button class="tc-icon-btn tc-icon-btn-sm" @click="activePlaylist = null">
            <Icon name="x" :size="15" />
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
          <div v-if="!activeTracks.length" class="tc-empty">
            <div class="tc-empty-icon"><Icon name="disc" :size="20" /></div>
            <div class="tc-empty-title">歌单还是空的</div>
            <div class="tc-empty-desc">在曲库列表上点「加入歌单」</div>
          </div>
          <div v-for="(s, i) in activeTracks" :key="s.id" class="tc-row group">
            <span class="w-5 shrink-0 text-center tc-num text-xs"
              :class="isCurrent(s) ? 'text-accent' : 'text-fg-subtle'">{{ i + 1 }}</span>
            <div class="tc-cover tc-cover-sm">
              <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <Icon v-else name="music" :size="13" class="text-fg-subtle" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate" :class="isCurrent(s) ? 'text-accent' : 'text-fg'">{{ s.title }}</div>
              <div class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100"
              title="播放" @click="playTrackAt(activePlaylist, i)">
              <Icon name="play" :size="14" />
            </button>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70"
              title="移出歌单" @click="removeTrack(activePlaylist, s)">
              <Icon name="x" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

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
import OnlineSearch from '../components/OnlineSearch.vue';
import Icon from '../components/Icon.vue';

const PAGE = 50;
const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);

const onlineKwInput = ref('');
const onlineKw = ref('');
const onlineSearching = ref(false);

// 曲库页只保留云端搜索；本地检索归主页，避免两个搜索框语义混淆
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
  data.value = await api.library(PAGE, offset.value, '');
}
async function loadStats() { stats.value = await api.libraryStats(); }
async function loadPlaylists() { const r = await api.playlists(); playlists.value = (r && r.playlists) || []; }

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
