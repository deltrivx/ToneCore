<template>
  <div class="space-y-3">
    <!-- 检索维度：歌曲 / 歌手 / 专辑（参考 RoMusic 的多种检索入口） -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="inline-flex rounded-lg border border-ink-700 overflow-hidden">
        <button v-for="t in TYPES" :key="t.id"
          class="px-3 py-1.5 text-xs transition-colors"
          :class="type === t.id ? 'bg-neon-dim/20 text-neon-soft' : 'text-slate-500 hover:text-slate-300'"
          @click="switchType(t.id)">{{ t.label }}</button>
      </div>
      <span v-if="type !== 'song'" class="text-[11px] text-slate-600">
        按{{ type === 'artist' ? '歌手' : '专辑' }}检索，返回该{{ type === 'artist' ? '歌手的热门曲目' : '专辑的完整曲目' }}
      </span>
    </div>

    <div v-if="!keyword" class="tc-card p-8 text-center text-sm text-slate-600">
      输入关键词，联网搜索各平台音乐
    </div>
    <div v-else-if="loading" class="tc-card p-8 text-center text-sm text-slate-600">搜索中…</div>
    <div v-else-if="!total" class="tc-card p-8 text-center text-sm text-slate-600">
      没有搜到「{{ keyword }}」的在线结果
    </div>

    <template v-else>
      <!-- 汇总操作：一次把全部结果存进本地曲库（离线也"在"曲库） -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-slate-500">
          共 <b class="text-neon-soft font-mono">{{ total }}</b> 条结果
        </span>
        <button class="tc-btn text-xs" :disabled="busy" @click="saveAll">
          {{ busy === 'all' ? '入库中…' : '全部入库' }}
        </button>
        <span class="text-[11px] text-slate-600">入库 = 下载到本地曲库（可在「主页」离线播放）</span>
      </div>

      <div v-for="(list, plat) in results" :key="plat">
        <div class="flex items-center gap-2 mb-2">
          <span class="tc-badge text-[10px]">{{ PLAT_LABEL[plat] || String(plat).toUpperCase() }}</span>
          <span class="text-xs text-slate-600">{{ list.length }} 首</span>
          <button class="text-[11px] text-slate-500 hover:text-neon-soft ml-auto"
            :disabled="busy" @click="savePlatform(plat, list)">
            该平台全部入库
          </button>
        </div>
        <div class="tc-card overflow-hidden divide-y divide-ink-800 mb-3">
          <div v-for="(s, i) in list" :key="s.id || i"
            class="px-3 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group">
            <div class="w-8 h-8 shrink-0 rounded overflow-hidden bg-ink-800 flex items-center justify-center">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <span v-else class="text-slate-600 text-xs">♪</span>
            </div>
            <div class="min-w-0 flex-1 cursor-pointer" @click="play(list, i)">
              <div class="text-slate-200 truncate">{{ s.title }}</div>
              <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-slate-600 truncate hidden md:inline max-w-[130px] text-xs cursor-pointer"
              @click="play(list, i)">{{ s.album }}</span>
            <button class="tc-icon-btn shrink-0 text-[10px]" title="播放试听" @click="play(list, i)">▶</button>
            <button class="tc-icon-btn shrink-0 text-[10px]" title="加入队列" @click="add(s)">＋</button>
            <button class="tc-btn shrink-0 text-[11px] px-2 py-1" :disabled="busy"
              title="下载到本地曲库" @click="saveOne(s)">
              {{ busy === key(plat, s) ? '…' : '入库' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="message" class="tc-card p-3 text-sm" :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer } from '../composables/usePlayer.js';

/**
 * 联网搜索结果渲染（曲库顶部「云端搜索」出口）。
 * 取 /api/search 的多平台聚合结果；支持按 歌曲/歌手/专辑 三种维度检索，
 * 并可直接试听、入队，或「入库」（下载落盘到本地曲库）。
 */
const props = defineProps({ keyword: { type: String, default: '' } });
const PLAT_LABEL = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };
const TYPES = [
  { id: 'song', label: '歌曲' },
  { id: 'artist', label: '歌手' },
  { id: 'album', label: '专辑' },
];

const player = usePlayer();
const results = ref({});
const loading = ref(false);
const message = ref(null);
const type = ref('song');
const busy = ref(null);

const total = computed(() =>
  Object.values(results.value).reduce((n, l) => n + (l?.length || 0), 0)
);

function key(plat, s) { return plat + ':' + (s.id || s.title); }

async function run(kw) {
  if (!kw || !kw.trim()) { results.value = {}; loading.value = false; return; }
  loading.value = true; message.value = null;
  try {
    const r = await api.search(kw.trim(), type.value);
    if (r && r.ok) {
      results.value = r.platforms || {};
      if (!total.value) message.value = { ok: false, text: '没有搜到结果，可能音源未就绪（到「音源」页检查）' };
    } else {
      results.value = {};
      message.value = { ok: false, text: (r && r.error) || '搜索失败' };
    }
  } catch (e) {
    results.value = {};
    message.value = { ok: false, text: '搜索失败：' + e };
  } finally {
    loading.value = false;
  }
}

watch(() => props.keyword, (kw) => { if (kw) run(kw); }, { immediate: true });

function switchType(t) {
  if (type.value === t) return;
  type.value = t;
  if (props.keyword) run(props.keyword);
}

async function play(list, index) {
  message.value = null;
  try {
    const r = await player.playList(list, index);
    if (!r || r.ok === false) message.value = { ok: false, text: (r && r.error) || '这首歌暂时取不到可播放地址' };
    else if (!r.playUrl) message.value = { ok: false, text: `「${list[index].title}」取链失败，换一首试试` };
  } catch (e) { message.value = { ok: false, text: '播放失败：' + e }; }
}

async function add(song) {
  await player.append([song]);
  message.value = { ok: true, text: `已添加到队列：${song.title}` };
}

/** 单曲入库：/api/play 会取链并落盘到本地曲库 */
async function saveOne(s) {
  const k = 'one:' + (s.id || s.title);
  busy.value = k; message.value = null;
  try {
    const r = await api.play(s.title, s.artist);
    message.value = r && r.ok
      ? { ok: true, text: `已入库：${s.title}` }
      : { ok: false, text: `入库失败：${(r && r.error) || '取链失败'}` };
  } catch (e) {
    message.value = { ok: false, text: '入库失败：' + e };
  } finally { busy.value = null; }
}

async function savePlatform(plat, list) {
  busy.value = 'plat:' + plat;
  await saveBatch(list);
  busy.value = null;
}

async function saveAll() {
  busy.value = 'all';
  const all = Object.values(results.value).flat();
  await saveBatch(all);
  busy.value = null;
}

/**
 * 批量入库：逐条串行（服务端下载有并发与间隔限流，这里避免把自己打爆），
 * 实时汇报进度与成功数。
 */
async function saveBatch(list) {
  let ok = 0, fail = 0;
  message.value = { ok: true, text: `开始入库 0/${list.length}…` };
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    try {
      const r = await api.play(s.title, s.artist);
      if (r && r.ok) ok++; else fail++;
    } catch { fail++; }
    message.value = { ok: true, text: `入库进度 ${i + 1}/${list.length}（成功 ${ok}，失败 ${fail}）` };
  }
  message.value = fail
    ? { ok: false, text: `入库完成：成功 ${ok}，失败 ${fail}（部分曲目上游无版权）` }
    : { ok: true, text: `入库完成：成功 ${ok} 首，可到「主页」查看` };
}
</script>
