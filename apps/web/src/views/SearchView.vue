<template>
  <div class="space-y-4 max-w-4xl mx-auto">
    <!-- 搜索框 -->
    <div class="flex gap-2">
      <input v-model="keyword" class="tc-input flex-1"
        placeholder="搜歌名 / 歌手，回车搜索" @keyup.enter="doSearch" />
      <button class="tc-btn-primary shrink-0" :disabled="loading || !keyword.trim()" @click="doSearch">
        {{ loading ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <!-- 平台状态提示（含已下线平台说明） -->
    <div v-if="retired && Object.keys(retired).length" class="text-[11px] text-slate-600 leading-relaxed">
      <span class="text-slate-500">可用平台：</span>
      <span class="font-mono text-neon-soft">{{ (active || []).join(' / ') }}</span>
      <span class="mx-1">·</span>
      <span class="text-slate-500">已下线：</span>
      <span v-for="(reason, p) in retired" :key="p" class="font-mono text-slate-600" :title="reason">
        {{ p }}({{ reason }})
      </span>
    </div>

    <div v-if="searched && total === 0" class="tc-card p-10 text-center space-y-2">
      <div class="text-slate-400">没有找到「{{ lastKeyword }}」</div>
      <div class="text-xs text-slate-600">换个关键词试试，或检查「音源」页面的脚本状态</div>
    </div>

    <!-- 搜索结果分组 -->
    <template v-else-if="total > 0">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="text-sm text-slate-500">
          找到 <span class="text-neon-soft font-mono">{{ total }}</span> 首
        </div>
        <button class="tc-btn text-xs py-1.5" @click="playAll">全部播放</button>
      </div>

      <div v-for="(list, platform) in results" :key="platform" class="tc-card overflow-hidden">
        <div class="px-4 py-2.5 border-b border-ink-700 flex items-center gap-2">
          <span class="text-xs font-medium text-slate-400 uppercase font-mono">{{ platform }}</span>
          <span class="text-[11px] text-slate-600">{{ list.length }} 首</span>
        </div>
        <div class="divide-y divide-ink-800">
          <div v-for="(s, i) in list" :key="s.id + i"
            class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-ink-800/50
                   transition-colors group cursor-pointer"
            @click="playOne(list, i)">
            <button class="tc-icon-btn shrink-0" title="播放">▶</button>
            <div class="min-w-0 flex-1">
              <div class="text-slate-200 truncate">{{ s.title }}</div>
              <div class="text-[11px] text-slate-600 truncate">{{ s.artist }}</div>
            </div>
            <span v-if="s.album" class="text-slate-600 truncate hidden md:inline max-w-[140px] text-xs">
              {{ s.album }}
            </span>
            <button class="tc-btn text-[11px] py-1 px-2 shrink-0 opacity-0 group-hover:opacity-100"
              title="添加到队列" @click.stop="addToQueue(s)">添加</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 初始引导 -->
    <div v-else class="tc-card p-10 text-center space-y-2">
      <div class="text-4xl text-slate-700">⌕</div>
      <div class="text-slate-400">搜索在线音乐</div>
      <div class="text-xs text-slate-600">
        点一首歌直接播放；播完会自动落库到本地曲库（可在设置里关闭）
      </div>
    </div>

    <div v-if="message" class="tc-card p-3 text-sm"
      :class="message.ok ? 'text-emerald-400' : 'text-amber-400'">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer } from '../composables/usePlayer.js';

const player = usePlayer();

const keyword = ref('');
const lastKeyword = ref('');
const results = ref({});
const loading = ref(false);
const searched = ref(false);
const message = ref(null);
const retired = ref({});
const active = ref([]);

const total = computed(() =>
  Object.values(results.value).reduce((n, list) => n + list.length, 0)
);

async function doSearch() {
  const kw = keyword.value.trim();
  if (!kw) return;
  loading.value = true;
  message.value = null;
  searched.value = true;
  try {
    const r = await api.search(kw);
    if (r && r.ok) {
      results.value = r.platforms || {};
      lastKeyword.value = kw;
    } else {
      results.value = {};
      message.value = { ok: false, text: (r && r.error) || '搜索失败' };
    }
  } catch (e) {
    message.value = { ok: false, text: '搜索失败：' + e };
  } finally {
    loading.value = false;
  }
}

/** 点击某一首：用该平台的整组结果建队列，从这首开始 */
async function playOne(list, index) {
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

/** 全部播放：把所有平台结果打平，从第一首开始 */
async function playAll() {
  const flat = Object.values(results.value).flat();
  if (!flat.length) return;
  await player.playList(flat, 0);
}

async function addToQueue(song) {
  await player.append([song]);
  message.value = { ok: true, text: `已添加到队列：${song.title}` };
}

onMounted(async () => {
  try {
    const p = await api.platforms();
    if (p) { retired.value = p.retired || {}; active.value = p.active || []; }
  } catch { /* 拿不到就只显示搜索框 */ }
});
</script>
