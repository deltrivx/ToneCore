<template>
  <div class="space-y-7">
    <!-- ============ 顶部：全网搜索 ============ -->
    <div class="flex gap-2">
      <input v-model="kw" class="tc-input flex-1" placeholder="全网搜索歌曲 / 歌手（回车）"
        @keyup.enter="doSearch" />
      <button class="tc-btn-primary shrink-0" :disabled="searching" @click="doSearch">
        {{ searching ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <!-- 在线搜索结果（内联，不跳页） -->
    <OnlineSearch v-if="onlineKw" :keyword="onlineKw" />

    <template v-if="!onlineKw">
      <!-- ============ 正在播放 Hero ============ -->
      <section class="relative overflow-hidden rounded-2xl border border-ink-700">
        <!-- 封面做模糊背景：有歌时整块跟着封面着色，空态才是纯色 -->
        <div v-if="coverBg" class="absolute inset-0 opacity-30 blur-3xl scale-125"
          :style="{ backgroundImage: `url(${coverBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }"></div>
        <div class="absolute inset-0 bg-gradient-to-br from-ink-850/95 via-ink-900/90 to-ink-950/95"></div>

        <div class="relative flex flex-col sm:flex-row items-center sm:items-stretch gap-5 p-5">
          <!-- 封面 -->
          <div class="w-32 h-32 sm:w-40 sm:h-40 shrink-0 rounded-xl overflow-hidden bg-ink-800 border border-ink-700 shadow-lg flex items-center justify-center">
            <img v-if="coverBg" :src="coverBg" class="w-full h-full object-cover" alt="" />
            <span v-else class="text-5xl text-slate-700">♫</span>
          </div>

          <!-- 曲目信息 + 控制 -->
          <div class="min-w-0 flex-1 flex flex-col justify-center text-center sm:text-left">
            <template v-if="cur">
              <div class="text-[11px] uppercase tracking-widest text-neon-soft/80 mb-1">正在播放</div>
              <div class="text-xl sm:text-2xl font-semibold text-slate-50 truncate">{{ cur.title }}</div>
              <div class="text-sm text-slate-400 truncate mt-0.5">
                {{ cur.artist || '未知歌手' }}<span v-if="cur.album"> · {{ cur.album }}</span>
              </div>

              <div class="flex items-center gap-2 mt-4">
                <span class="text-[11px] font-mono text-slate-500 w-10 text-right">{{ fmtTime(state.currentTime) }}</span>
                <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
                  :value="state.currentTime" @input="e => player.seek(Number(e.target.value))" />
                <span class="text-[11px] font-mono text-slate-500 w-10">{{ fmtTime(state.duration) }}</span>
              </div>

              <div class="flex items-center justify-center sm:justify-start gap-2 mt-3">
                <button class="tc-icon-btn w-9 h-9" :title="REPEAT_META[state.repeat].label" @click="player.cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
                <button class="tc-icon-btn w-9 h-9" title="上一首" @click="player.prev">⏮</button>
                <button class="w-12 h-12 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950 flex items-center justify-center text-lg hover:shadow-glow transition-shadow"
                  @click="player.toggle">{{ state.playing ? '⏸' : '▶' }}</button>
                <button class="tc-icon-btn w-9 h-9" title="下一首" @click="player.next">⏭</button>
                <button class="tc-icon-btn w-9 h-9" title="全屏歌词" @click="player.toggleExpand">⤢</button>
                <span v-if="state.queue.length" class="ml-2 text-[11px] text-slate-500 font-mono">
                  {{ state.index + 1 }}/{{ state.queue.length }}
                </span>
              </div>

              <div v-if="state.error" class="mt-2 text-xs text-rose-400">链接失效，可尝试换源</div>
            </template>

            <template v-else>
              <div class="text-[11px] uppercase tracking-widest text-slate-500 mb-1">未播放</div>
              <div class="text-xl sm:text-2xl font-semibold text-slate-300">挑一张专辑或歌单开始</div>
              <div class="text-sm text-slate-500 mt-1">下方点封面即可播放，或用顶部搜索找首歌</div>
            </template>
          </div>
        </div>
      </section>

      <!-- ============ 歌单 ============ -->
      <section>
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-base font-semibold text-slate-100">歌单</h2>
          <button class="text-xs text-slate-500 hover:text-neon-soft transition-colors" @click="createPlaylist">＋ 新建</button>
        </div>

        <div v-if="!playlists.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
          <div class="text-2xl text-slate-700 mb-1">♫</div>
          <div class="text-sm text-slate-500">还没有歌单</div>
          <div class="text-xs text-slate-600 mt-1">在「曲库」里把歌曲加入歌单，或点右上角新建</div>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div v-for="pl in playlists" :key="pl.id" class="group cursor-pointer" @click="openPlaylist(pl)">
            <div class="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700/60">
              <img v-if="pl.cover" :src="`/cover/${pl.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-4xl text-slate-700">♫</div>
              <!-- 悬停播放（Navidrome 式圆形按钮） -->
              <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55">
                <button class="w-12 h-12 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950 flex items-center justify-center text-lg shadow-glow"
                  title="播放歌单" @click.stop="playPlaylist(pl)">▶</button>
              </div>
              <button class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-rose-300/80 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px]"
                title="删除歌单" @click.stop="delPlaylist(pl)">✕</button>
            </div>
            <div class="mt-2 text-sm text-slate-200 truncate">{{ pl.name }}</div>
            <div class="text-xs text-slate-500">{{ pl.count }} 首</div>
          </div>
        </div>
      </section>

      <!-- ============ 最近添加（按专辑聚合，封面卡片） ============ -->
      <section v-if="albums.length">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-base font-semibold text-slate-100">最近添加</h2>
          <span class="text-xs text-slate-600">{{ albums.length }} 张</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div v-for="a in albums" :key="a.key" class="group cursor-pointer" @click="playAlbum(a)">
            <div class="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700/60">
              <img v-if="a.cover" :src="`/cover/${a.cover}`" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-3xl text-slate-700">♪</div>
              <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55">
                <button class="w-11 h-11 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950 flex items-center justify-center shadow-glow"
                  title="播放整张">▶</button>
              </div>
            </div>
            <div class="mt-2 text-sm text-slate-200 truncate">{{ a.name }}</div>
            <div class="text-xs text-slate-500 truncate">{{ a.artist }}</div>
          </div>
        </div>
      </section>
    </template>

    <!-- ============ 歌单详情（浮层） ============ -->
    <div v-if="activePlaylist" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      @click.self="activePlaylist = null">
      <div class="w-full sm:max-w-lg max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-ink-700 bg-ink-900 overflow-hidden">
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
            歌单还是空的，去「曲库」把歌曲加进来
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
              title="播放" @click="playTrack(activePlaylist, i)">▶</button>
            <button class="tc-icon-btn w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-rose-400/70"
              title="移出歌单" @click="removeTrack(activePlaylist, s)">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 加入歌单：选择浮层 -->
    <div v-if="pickSong" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="pickSong = null">
      <div class="tc-card w-full max-w-sm p-4 space-y-3">
        <div class="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>加入歌单：{{ pickSong.title }}</span>
          <button class="tc-icon-btn w-6 h-6" @click="pickSong = null">✕</button>
        </div>
        <div v-if="!playlists.length" class="text-xs text-slate-600 py-2">还没有歌单，可以先新建一个。</div>
        <div v-else class="max-h-[50vh] overflow-y-auto space-y-1">
          <button v-for="pl in playlists" :key="pl.id" class="w-full text-left px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-ink-800"
            @click="addToPlaylist(pl)">{{ pl.name }} <span class="text-slate-600 text-[11px]">（{{ pl.count }}）</span></button>
        </div>
        <button class="tc-btn-primary w-full text-xs" @click="createAndAdd">新建歌单并加入</button>
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
import { usePlayer, fmtTime, REPEAT_META } from '../composables/usePlayer.js';
import OnlineSearch from '../components/OnlineSearch.vue';

const player = usePlayer();
const state = player.state;
const cur = computed(() => player.current.value);
const coverBg = computed(() => player.coverUrl.value);

const kw = ref('');
const onlineKw = ref('');
const searching = ref(false);
const playlists = ref([]);
const recent = ref([]);
const activePlaylist = ref(null);
const activeTracks = ref([]);
const pickSong = ref(null);
const message = ref(null);

/** 最近添加按「歌手+专辑」聚合成封面卡片（Navidrome 的专辑墙观感） */
const albums = computed(() => {
  const m = new Map();
  for (const s of recent.value) {
    const artist = s.artist || '未知歌手';
    const key = artist + '||' + (s.album || '');
    if (!m.has(key)) {
      m.set(key, { key, name: s.album || s.title, artist, cover: s.cover, songs: [] });
    }
    m.get(key).songs.push(s);
  }
  return [...m.values()].slice(0, 12);
});

function isCurrent(s) { return cur.value && cur.value.filePath === s.filePath; }

async function doSearch() {
  const k = kw.value.trim();
  if (!k) return;
  searching.value = true; onlineKw.value = k;
  await new Promise(r => setTimeout(r, 50));
  searching.value = false;
}

async function loadPlaylists() {
  const r = await api.playlists();
  playlists.value = (r && r.playlists) || [];
}
async function loadRecent() {
  const r = await api.library(24, 0, '');
  recent.value = (r && r.songs) || [];
}

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

async function playTrack(pl, index) {
  const r = await api.playlistPlay(pl.id);
  if (r && r.ok) await player.jump(Math.min(index, state.queue.length - 1));
}

function playAlbum(a) {
  const songs = a.songs.map(s => ({
    title: s.title, artist: s.artist, album: s.album,
    filePath: s.filePath, platform: 'local', songId: String(s.id),
  }));
  player.playList(songs, 0);
}

async function removeTrack(pl, s) {
  const r = await api.playlistRemove(pl.id, s.id);
  if (r && r.ok) {
    const g = await api.playlistGet(pl.id);
    activeTracks.value = (g && g.tracks) || [];
    await loadPlaylists();
  }
}

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
  if (c && c.ok) {
    await api.playlistAdd(c.id, s.id);
    pickSong.value = null;
    await loadPlaylists();
    message.value = { ok: true, text: '已新建并加入歌单' };
  }
}

onMounted(() => { loadPlaylists(); loadRecent(); });
</script>
