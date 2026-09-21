<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">总览</h1>
      <p class="text-sm text-slate-500 mt-0.5">音乐中枢运行状态</p>
    </div>

    <!-- 指标卡 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="tc-card p-4">
        <div class="text-xs text-slate-500 mb-1">音源脚本</div>
        <div class="text-2xl font-semibold text-neon-soft font-mono">{{ h?.sources ?? '-' }}</div>
      </div>
      <div class="tc-card p-4">
        <div class="text-xs text-slate-500 mb-1">曲库歌曲</div>
        <div class="text-2xl font-semibold text-slate-100 font-mono">{{ h?.library ?? '-' }}</div>
      </div>
      <div class="tc-card p-4">
        <div class="text-xs text-slate-500 mb-1">下载队列</div>
        <div class="text-2xl font-semibold font-mono"
          :class="(h?.queue?.pending + h?.queue?.size) > 0 ? 'text-amber-400' : 'text-slate-100'">
          {{ (h?.queue?.pending ?? 0) + (h?.queue?.size ?? 0) }}
        </div>
      </div>
      <div class="tc-card p-4">
        <div class="text-xs text-slate-500 mb-1">音箱接入</div>
        <div class="text-2xl font-semibold font-mono"
          :class="h?.speaker ? 'text-emerald-400' : 'text-slate-600'">
          {{ h?.speaker ? 'ON' : 'OFF' }}
        </div>
      </div>
    </div>

    <!-- 点歌测试 -->
    <div class="tc-card p-4">
      <div class="text-sm font-medium text-slate-300 mb-3">点歌测试</div>
      <div class="flex gap-2 flex-col sm:flex-row">
        <input v-model="kw" class="tc-input flex-1" placeholder="输入歌名，如：本草纲目"
          @keyup.enter="doPlay" />
        <button class="tc-btn-primary shrink-0" :disabled="loading || !kw" @click="doPlay">
          {{ loading ? '解析中…' : '点播' }}
        </button>
      </div>

      <div v-if="result" class="mt-3 p-3 rounded-lg bg-ink-900 border border-ink-700 text-sm space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="tc-dot" :class="result.ok ? 'tc-dot-ok' : 'tc-dot-warn'"></span>
          <span class="text-slate-300">{{ result.ok ? '解析成功' : '失败' }}</span>
          <span v-if="result.origin" class="tc-badge">{{ result.origin === 'local' ? '本地曲库' : '在线音源' }}</span>
          <span v-if="result.fetching" class="tc-badge">后台落库中</span>
        </div>
        <div v-if="result.ok" class="text-slate-400">
          {{ result.artist }} — {{ result.title }}
        </div>
        <div v-else class="text-amber-400/80 text-xs">{{ result.error }}</div>
        <div v-if="result.playUrl" class="text-xs text-slate-600 font-mono break-all">
          {{ result.playUrl.slice(0, 90) }}
        </div>
      </div>
    </div>

    <!-- 下载记录 -->
    <div class="tc-card overflow-hidden">
      <div class="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
        <span class="text-sm font-medium text-slate-300">最近落库记录</span>
        <button class="tc-btn text-xs py-1 px-2" @click="loadLogs">刷新</button>
      </div>
      <div v-if="logs.length === 0" class="px-4 py-8 text-center text-sm text-slate-600">
        暂无记录
      </div>
      <div v-else class="divide-y divide-ink-800">
        <div v-for="l in logs" :key="l.id" class="px-4 py-2.5 flex items-center gap-3 text-sm">
          <span class="tc-dot shrink-0"
            :class="l.status === 'success' ? 'tc-dot-ok' : 'tc-dot-warn'"></span>
          <span class="text-slate-300 truncate flex-1">{{ l.title }}</span>
          <span class="text-slate-600 truncate hidden sm:inline max-w-[140px]">{{ l.artist }}</span>
          <span class="tc-badge shrink-0">{{ l.quality || '-' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({ health: Object });
const h = ref(props.health);
const kw = ref('');
const loading = ref(false);
const result = ref(null);
const logs = ref([]);

async function doPlay() {
  loading.value = true;
  result.value = null;
  try {
    result.value = await api.play(kw.value);
    await loadLogs();
    h.value = await api.health();
  } finally {
    loading.value = false;
  }
}

async function loadLogs() {
  const d = await api.downloads();
  logs.value = d.logs || [];
}

onMounted(() => {
  loadLogs();
  setInterval(() => { h.value = props.health; }, 2000);
});
</script>
