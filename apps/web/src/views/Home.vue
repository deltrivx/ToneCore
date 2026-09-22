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
      <!-- ============ 本地音乐（主页默认展示） ============ -->
      <section>
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-base font-semibold text-slate-100">本地音乐</h2>
          <div class="flex items-center gap-3">
            <span class="text-xs text-slate-600">共 {{ total }} 首</span>
            <button class="text-xs text-slate-500 hover:text-neon-soft transition-colors"
              :disabled="loading" @click="load">
              {{ loading ? '载入中…' : '刷新' }}
            </button>
          </div>
        </div>

        <div v-if="loading && !songs.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
          <div class="text-sm text-slate-500">载入中…</div>
        </div>

        <div v-else-if="!songs.length" class="rounded-xl border border-dashed border-ink-700 p-8 text-center">
          <div class="text-2xl text-slate-700 mb-1">♪</div>
          <div class="text-sm text-slate-500">曲库还没有歌曲</div>
          <div class="text-xs text-slate-600 mt-1">去「曲库」点「扫描」建立索引</div>
        </div>

        <template v-else>
          <!-- 专辑墙（按歌手+专辑聚合，封面优先） -->
          <div v-if="albums.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div v-for="a in albums" :key="a.key" class="group cursor-pointer" @click="playAlbum(a)">
              <div class="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700/60">
                <img v-if="a.cover" :src="`/cover/${a.cover}`" class="w-full h-full object-cover" loading="lazy" />
                <div v-else class="w-full h-full flex items-center justify-center text-3xl text-slate-700">♪</div>
                <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55">
                  <button class="w-11 h-11 rounded-full bg-gradient-to-br from-neon-dim to-neon
                                 text-ink-950 flex items-center justify-center shadow-glow"
                    title="播放整张">▶</button>
                </div>
              </div>
              <div class="mt-2 text-sm text-slate-200 truncate">{{ a.name }}</div>
              <div class="text-xs text-slate-500 truncate">{{ a.artist }}</div>
            </div>
          </div>

          <!-- 曲目列表 -->
          <div class="mt-6 tc-card overflow-hidden divide-y divide-ink-800">
            <div v-for="(s, i) in songs" :key="s.id"
              class="px-2 sm:px-4 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50
                     transition-colors group cursor-pointer"
              @click="playSong(i)">
              <div class="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-ink-700 flex items-center justify-center relative">
                <img v-if="s.cover" :src="`/cover/${s.cover}`" class="w-full h-full object-cover" loading="lazy" />
                <span v-else class="text-slate-500 text-xs">{{ initial(s) }}</span>
                <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white text-xs">
                  ▶
                </div>
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
        </template>
      </section>
    </template>

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
import OnlineSearch from '../components/OnlineSearch.vue';

const player = usePlayer();
const cur = computed(() => player.current.value);

const kw = ref('');
const onlineKw = ref('');
const searching = ref(false);
const songs = ref([]);
const total = ref(0);
const loading = ref(false);
const message = ref(null);

/** 按「歌手+专辑」聚合成封面卡片 */
const albums = computed(() => {
  const m = new Map();
  for (const s of songs.value) {
    const artist = s.artist || '未知歌手';
    const key = artist + '||' + (s.album || '');
    if (!m.has(key)) m.set(key, { key, name: s.album || s.title, artist, cover: s.cover, songs: [] });
    m.get(key).songs.push(s);
  }
  return [...m.values()].slice(0, 12);
});

function initial(s) { const t = String(s.title || '').trim(); return t ? t[0].toUpperCase() : '♪'; }
function isCurrent(s) { return cur.value && cur.value.filePath === s.filePath; }
function fmtDur(d) { return d ? fmtTime(d) : '--:--'; }

async function doSearch() {
  const k = kw.value.trim();
  if (!k) return;
  searching.value = true; onlineKw.value = k;
  await new Promise(r => setTimeout(r, 50));
  searching.value = false;
}

async function load() {
  loading.value = true;
  try {
    const r = await api.library(200, 0, '');
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

/** 点哪首就从哪首开始播（整份列表进队列，符合直觉） */
async function playSong(i) {
  await player.playList(toQueue(songs.value), i);
}

async function appendSong(s) {
  await player.append(toQueue([s]));
  message.value = { ok: true, text: `已加入队列：${s.title}` };
  setTimeout(() => { message.value = null; }, 1800);
}

async function playAlbum(a) {
  await player.playList(toQueue(a.songs), 0);
}

onMounted(() => { load(); });
</script>
