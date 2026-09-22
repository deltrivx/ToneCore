<template>
  <div class="space-y-3">
    <div v-if="!keyword" class="tc-card p-8 text-center text-sm text-slate-600">
      输入关键词，联网搜索各平台音乐
    </div>
    <div v-else-if="loading" class="tc-card p-8 text-center text-sm text-slate-600">搜索中…</div>
    <div v-else-if="!total" class="tc-card p-8 text-center text-sm text-slate-600">
      没有搜到「{{ keyword }}」的在线结果
    </div>
    <template v-else>
      <div v-for="(list, plat) in results" :key="plat">
        <div class="flex items-center gap-2 mb-2">
          <span class="tc-badge text-[10px]">{{ PLAT_LABEL[plat] || String(plat).toUpperCase() }}</span>
          <span class="text-xs text-slate-600">{{ list.length }} 首</span>
        </div>
        <div class="tc-card overflow-hidden divide-y divide-ink-800 mb-3">
          <div v-for="(s, i) in list" :key="s.id || i"
            class="px-3 py-2 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors group cursor-pointer"
            @click="play(list, i)">
            <div class="min-w-0 flex-1">
              <div class="text-slate-200 truncate">{{ s.title }}</div>
              <div class="text-xs text-slate-500 truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-slate-600 truncate hidden md:inline max-w-[130px] text-xs">{{ s.album }}</span>
            <button class="tc-icon-btn shrink-0 opacity-0 group-hover:opacity-100 text-[10px]"
              title="添加到队列" @click.stop="add(s)">＋</button>
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
 * 联网搜索结果渲染（主页与曲库共用的顶部「全网搜索」出口）。
 * 取 /api/search 的多平台聚合结果，可直接试听 / 入队。
 */
const props = defineProps({ keyword: { type: String, default: '' } });
const PLAT_LABEL = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };

const player = usePlayer();
const results = ref({});
const loading = ref(false);
const message = ref(null);
const total = computed(() =>
  Object.values(results.value).reduce((n, l) => n + (l?.length || 0), 0)
);

async function run(kw) {
  if (!kw || !kw.trim()) { results.value = {}; loading.value = false; return; }
  loading.value = true; message.value = null;
  try {
    const r = await api.search(kw.trim());
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
</script>
