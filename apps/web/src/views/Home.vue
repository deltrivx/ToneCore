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

    <!-- ============ 推荐：最近入库 ============ -->
    <section v-if="!localKw && home.recent.length" class="space-y-2">
      <h3 class="tc-section-title">最近入库</h3>
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        <div v-for="s in home.recent" :key="s.id" class="group cursor-pointer" @click="playHomeSong(s)">
          <div class="relative tc-cover-art">
            <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
            <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
              <Icon name="music" :size="22" />
            </div>
            <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
              :title="`播放 ${s.title}`">
              <span class="w-8 h-8 rounded-full bg-accent text-fg-inverse flex items-center justify-center">
                <Icon name="play" :size="14" />
              </span>
            </button>
          </div>
          <div class="mt-1 text-[11px] text-fg truncate">{{ s.title }}</div>
          <div class="text-[10px] text-fg-subtle truncate">{{ s.artist }}</div>
        </div>
      </div>
    </section>

    <!-- ============ 推荐：专辑 / 歌手分类 ============ -->
    <section v-if="!localKw && home.albums.length" class="space-y-2">
      <h3 class="tc-section-title">专辑</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="a in home.albums" :key="a.name"
          class="tc-chip hover:bg-white/[0.09] transition-colors max-w-[220px]"
          :title="`${a.name} · ${a.count} 首`" @click="filterBy('album', a.name)">
          <span class="truncate">{{ a.name }}</span>
          <span class="tc-num opacity-60 ml-1">{{ a.count }}</span>
        </button>
      </div>
    </section>

    <section v-if="!localKw && home.artists.length" class="space-y-2">
      <h3 class="tc-section-title">歌手</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="a in home.artists" :key="a.name"
          class="tc-chip hover:bg-white/[0.09] transition-colors max-w-[180px]"
          :title="`${a.name} · ${a.count} 首`" @click="filterBy('artist', a.name)">
          <span class="truncate">{{ a.name }}</span>
          <span class="tc-num opacity-60 ml-1">{{ a.count }}</span>
        </button>
      </div>
    </section>

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

/** 首页聚合数据：歌单 + 推荐分区 + 统计 */
const home = ref({ playlists: [], recent: [], albums: [], artists: [], stats: null });
const homeLoading = ref(false);

async function loadHome() {
  homeLoading.value = true;
  try {
    const r = await api.home();
    if (r) home.value = {
      playlists: r.playlists || [],
      recent: r.recent || [],
      albums: r.albums || [],
      artists: r.artists || [],
      stats: r.stats || null,
    };
  } catch { /* 首页增量数据失败不影响曲库主体，静默 */ }
  finally { homeLoading.value = false; }
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

/** 首页推荐卡片：单曲直接播放（放进当前可见列表里定位） */
async function playHomeSong(s) {
  localKw.value = '';
  const list = songs.value.length ? songs.value : home.value.recent;
  const i = list.findIndex((x) => x.id === s.id);
  await player.playList(toQueue(list), Math.max(0, i));
}

/** 点分类推荐 → 落到本地检索框 */
function filterBy(kind, name) {
  localKw.value = name;
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

onMounted(() => { load(); loadHome(); });
</script>
