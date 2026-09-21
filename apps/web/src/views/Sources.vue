<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">音源</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          已加载 <span class="text-neon-soft font-mono">{{ data?.count ?? 0 }}</span> 个音源脚本
        </p>
      </div>
      <button class="tc-btn shrink-0" :disabled="loading" @click="reload">
        {{ loading ? '加载中…' : '重新加载' }}
      </button>
    </div>

    <div v-if="!data?.sources?.length" class="tc-card p-8 text-center text-sm text-slate-600">
      尚未加载音源脚本<br />
      <span class="text-xs">把洛雪 <code class="tc-badge">.js</code> 音源放入数据目录的 <code class="tc-badge">sources/</code> 后点击重新加载</span>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="s in data.sources" :key="s.name" class="tc-card p-3.5">
        <div class="text-sm text-slate-200 truncate">{{ s.name }}</div>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span v-for="p in s.platforms" :key="p" class="tc-badge text-[10px]">{{ p }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const data = ref(null);
const loading = ref(false);

async function reload() {
  loading.value = true;
  try {
    await api.reloadSources();
    data.value = await api.sources();
  } finally { loading.value = false; }
}

onMounted(async () => { data.value = await api.sources(); });
</script>
