<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">曲库</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          共 <span class="text-neon-soft font-mono">{{ data?.total ?? 0 }}</span> 首
        </p>
      </div>
      <div class="flex gap-2">
        <button class="tc-btn" :disabled="scanning" @click="scan">
          {{ scanning ? '扫描中…' : '扫描' }}
        </button>
        <button class="tc-btn" :disabled="auditing" @click="audit">
          {{ auditing ? '审计中…' : '元数据审计' }}
        </button>
      </div>
    </div>

    <div v-if="auditResult" class="tc-card p-3 text-sm flex flex-wrap gap-4">
      <span class="text-slate-400">检查 <b class="text-slate-200">{{ auditResult.checked }}</b> 首</span>
      <span class="text-slate-400">缺封面 <b class="text-amber-400">{{ auditResult.missingCover }}</b></span>
      <span class="text-slate-400">缺元数据 <b class="text-amber-400">{{ auditResult.missingMeta }}</b></span>
    </div>

    <div v-if="!data?.songs?.length" class="tc-card p-8 text-center text-sm text-slate-600">
      曲库为空，点击「扫描」建立索引
    </div>

    <div v-else class="tc-card overflow-hidden divide-y divide-ink-800">
      <div v-for="s in data.songs" :key="s.id"
        class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-ink-800/50 transition-colors">
        <span class="text-slate-600 font-mono text-xs w-10 shrink-0">{{ s.id }}</span>
        <span class="text-slate-200 truncate flex-1">{{ s.title }}</span>
        <span class="text-slate-500 truncate hidden sm:inline max-w-[120px]">{{ s.artist }}</span>
        <span class="text-slate-600 truncate hidden md:inline max-w-[140px] text-xs">{{ s.album }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const data = ref(null);
const scanning = ref(false);
const auditing = ref(false);
const auditResult = ref(null);

async function load() { data.value = await api.library(100, 0); }

async function scan() {
  scanning.value = true;
  try { await api.scan(); await load(); } finally { scanning.value = false; }
}

async function audit() {
  auditing.value = true;
  try { auditResult.value = await api.audit(200); } finally { auditing.value = false; }
}

onMounted(load);
</script>
