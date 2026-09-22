<template>
  <div class="space-y-5">
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

    <!-- ============ 主体：左 歌单/最近；右 正在播放 ============ -->
    <div v-if="!onlineKw" class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <div class="space-y-5 min-w-0">
        <!-- 歌单 -->
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold text-slate-200">歌单</h2>
            <button class="tc-btn text-xs" @click="createPlaylist">＋ 新建歌单</button>
          </div>

          <div v-if="!playlists.length" class="tc-card p-6 text-center text-sm text-slate-600">
            还没有歌单。在「曲库」里把歌曲加入歌单，或点上方新建。
          </div>

          <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div v-for="pl in playlists" :key="pl.id"
              class="tc-card overflow-hidden group">
              <!-- 封面 -->
              <div class="relative aspect-square bg-ink-800 cursor-pointer" @click="toggleExpand(pl.id)">
                <img v-if="pl.cover" :src="`/cover/${pl.cover}`" class="w-full h-full object-cover" loading="lazy" />
                <div v-else class="w-full h-full flex items-center justify-center text-3xl text-slate-700">♫</div>
                <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white text-2xl"
                  title="播放歌单" @click.stop="playPlaylist(pl)">▶</button>
              </div>
              <!-- 信息行 -->
              <div class="px-3 py-2 flex items-center gap-2">
                <button class="min-w-0 text-left flex-1" @click="toggleExpand(pl.id)">
                  <div class="text-sm text-slate-200 truncate">{{ pl.name }}</div>
                  <div class="text-[11px] text-slate-600">{{ pl.count }} 首</div>
                </button>
                <button class="tc-icon-btn w-6 h-6 shrink-0 text-rose-400/70 hover:text-rose-400 text-xs"
                  title="删除歌单" @click.stop="delPlaylist(pl)">✕</button>
              </div>

              <!-- 展开：曲目 -->
              <div v-if="expandedId === pl.id" class="border-t border-ink-700 max-h-[260px] overflow-y-auto divide-y divide-ink-800">
                <div v-if="!expandedTracks.length" class="px-3 py-4 text-xs text-slate-600 text-center">
                  歌单还是空的，去「曲库」加入歌曲
                </div>
                <div v-for="(s, i) in expandedTracks" :key="s.id"
                  class="px-3 py-2 flex items-center gap-2 text-xs hover:bg-ink-800/50 cursor-pointer group"
                  @click="playTrack(pl, i)">
                  <span class="w-4 shrink-0 text-center font-mono text-slate-700">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate" :class="isCurrent(s) ? 'text-neon-soft' : 'text-slate-300'">
                    {{ s.title }}
                  </span>
                  <button class="tc-icon-btn w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70 hover:text-rose-400 text-[10px]"
                    title="移出歌单" @click.stop="removeTrack(pl, s)">✕</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 最近添加（防空态；新用户也能直接播放） -->
        <section v-if="recent.length">
          <h2 class="text-sm font-semibold text-slate-200 mb-3">最近添加</h2>
          <div class="tc-card overflow-hidden divide-y divide-ink-800">
            <div v-for="(s, i) in recent" :key="s.id"
              class="px-2 sm:px-4 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group cursor-pointer"
              @dblclick="playRecent(i)">
              <div class="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-ink-700 flex items-center justify-center relative">
                <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
                <span v-else class="text-slate-500 text-xs">{{ initial(s) }}</span>
                <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white text-xs"
                  title="播放" @click.stop="playRecent(i)">▶</button>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-slate-200 truncate" :class="{ 'text-neon-soft': isCurrent(s) }">{{ s.title }}</div>
                <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
              </div>
              <span class="text-slate-600 truncate hidden md:inline max-w-[140px] text-xs">{{ s.album }}</span>
              <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
                title="加入歌单" @click.stop="openPick(s)">＋</button>
            </div>
          </div>
        </section>
      </div>

      <!-- ============ 右：正在播放（主页的「播放」职责所在） ============ -->
      <aside class="tc-card overflow-hidden lg:sticky lg:top-0">
        <div class="px-3 py-2.5 border-b border-ink-700 flex items-center gap-2">
          <span class="text-sm font-medium text-slate-300">正在播放</span>
          <span v-if="state.queue.length" class="text-[11px] text-slate-600 font-mono">
            {{ state.index + 1 }}/{{ state.queue.length }}
          </span>
          <button v-if="state.queue.length" class="tc-btn text-xs py-1 px-2 ml-auto" @click="player.clear">清空</button>
        </div>

        <div v-if="!cur" class="p-8 text-center space-y-2">
          <div class="text-3xl text-slate-700">♫</div>
          <div class="text-xs text-slate-600">在左侧点一首歌或播放歌单开始</div>
        </div>

        <template v-else>
          <div class="p-3 flex items-center gap-3">
            <div class="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-ink-800 border border-ink-700 flex items-center justify-center">
              <img v-if="player.coverUrl.value" :src="player.coverUrl.value" class="w-full h-full object-cover" alt="" />
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
                <span v-if="state.error" class="text-[10px] text-rose-400">链接失效</span>
              </div>
            </div>
          </div>

          <div class="px-3 flex items-center gap-2">
            <span class="text-[10px] font-mono text-slate-600 w-9 text-right">{{ fmtTime(state.currentTime) }}</span>
            <input class="tc-range flex-1" type="range" min="0" :max="state.duration || 0" step="0.5"
              :value="state.currentTime" @input="e => player.seek(Number(e.target.value))" />
            <span class="text-[10px] font-mono text-slate-600 w-9">{{ fmtTime(state.duration) }}</span>
          </div>

          <div class="px-3 py-2 flex items-center justify-center gap-2">
            <button class="tc-icon-btn w-8 h-8" :title="REPEAT_META[state.repeat].label" @click="player.cycleRepeat">{{ REPEAT_META[state.repeat].icon }}</button>
            <button class="tc-icon-btn w-8 h-8" title="上一首" @click="player.prev">⏮</button>
            <button class="w-10 h-10 rounded-full bg-gradient-to-br from-neon-dim to-neon text-ink-950 flex items-center justify-center hover:shadow-glow transition-shadow"
              @click="player.toggle">{{ state.playing ? '⏸' : '▶' }}</button>
            <button class="tc-icon-btn w-8 h-8" title="下一首" @click="player.next">⏭</button>
            <button class="tc-icon-btn w-8 h-8" title="全屏歌词" @click="player.toggleExpand">⤢</button>
          </div>

          <div class="border-t border-ink-700">
            <div class="px-3 py-2 text-xs text-slate-500">播放队列</div>
            <div class="max-h-[240px] overflow-y-auto divide-y divide-ink-800">
              <div v-for="(s, i) in state.queue" :key="s.uid"
                class="px-3 py-2 flex items-center gap-2 text-xs cursor-pointer group"
                :class="i === state.index ? 'bg-ink-800' : 'hover:bg-ink-800/50'"
                @click="player.jump(i)">
                <span class="w-4 shrink-0 text-center font-mono text-[10px]"
                  :class="i === state.index ? 'text-neon' : 'text-slate-700'">
                  <span v-if="i === state.index && state.playing" class="tc-bars inline-flex"><i></i><i></i><i></i></span>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="truncate flex-1" :class="i === state.index ? 'text-neon-soft' : 'text-slate-400'">{{ s.title }}</span>
                <button class="tc-icon-btn w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100 text-rose-400/70 hover:text-rose-400 text-[10px]"
                  title="移除" @click.stop="player.removeAt(s.uid)">✕</button>
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>

    <!-- 加入歌单：选择浮层 -->
    <div v-if="pickSong" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="pickSong = null">
      <div class="tc-card w-full max-w-sm p-4 space-y-3">
        <div class="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>加入歌单：{{ pickSong.title }}</span>
          <button class="tc-icon-btn w-6 h-6" @click="pickSong = null">✕</button>
        </div>
        <div v-if="!playlists.length" class="text-xs text-slate-600 py-2">还没有歌单，先去主页新建一个。</div>
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

const kw = ref('');
const onlineKw = ref('');
const searching = ref(false);
const playlists = ref([]);
const recent = ref([]);
const expandedId = ref(null);
const expandedTracks = ref([]);
const pickSong = ref(null);
const message = ref(null);

function initial(s) { const t = String(s.title || '').trim(); return t ? t[0].toUpperCase() : '♪'; }
function isCurrent(s) { return cur.value && cur.value.filePath === s.filePath; }

async function doSearch() {
  const k = kw.value.trim();
  if (!k) return;
  searching.value = true; onlineKw.value = k;
  // 结果由 OnlineSearch 组件异步拉取；这里只负责切换视图
  await new Promise(r => setTimeout(r, 50));
  searching.value = false;
}

async function loadPlaylists() {
  const r = await api.playlists();
  playlists.value = (r && r.playlists) || [];
}
async function loadRecent() {
  const r = await api.library(12, 0, '');
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
  if (r && r.ok) { playlists.value = playlists.value.filter(p => p.id !== pl.id); if (expandedId.value === pl.id) expandedId.value = null; }
  else message.value = { ok: false, text: (r && r.error) || '删除失败' };
}

async function toggleExpand(id) {
  if (expandedId.value === id) { expandedId.value = null; expandedTracks.value = []; return; }
  const r = await api.playlistGet(id);
  expandedTracks.value = (r && r.ok && r.tracks) || [];
  expandedId.value = id;
}

async function playPlaylist(pl) {
  message.value = null;
  try {
    const r = await api.playlistPlay(pl.id);
    if (r && r.ok) { await player.refresh(); }
    else message.value = { ok: false, text: (r && r.error) || '歌单为空' };
  } catch (e) { message.value = { ok: false, text: '播放失败：' + e }; }
}

async function playTrack(pl, index) {
  // 整张歌单灌入队列并从这首开始
  const r = await api.playlistPlay(pl.id);
  if (r && r.ok) {
    // 重新定位到点击的曲目
    await player.jump(Math.min(index, state.queue.length - 1));
  }
}

function playRecent(index) {
  const songs = recent.value.map(s => ({
    title: s.title, artist: s.artist, album: s.album,
    filePath: s.filePath, platform: 'local', songId: String(s.id),
  }));
  player.playList(songs, index);
}

async function removeTrack(pl, s) {
  const r = await api.playlistRemove(pl.id, s.id);
  if (r && r.ok) {
    if (expandedId.value === pl.id) { const g = await api.playlistGet(pl.id); expandedTracks.value = (g && g.tracks) || []; }
    await loadPlaylists();
  }
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
  if (c && c.ok) {
    await api.playlistAdd(c.id, s.id);
    pickSong.value = null;
    await loadPlaylists();
    message.value = { ok: true, text: '已新建并加入歌单' };
  }
}

onMounted(() => { loadPlaylists(); loadRecent(); });
</script>
