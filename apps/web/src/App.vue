<template>
  <div class="min-h-full flex flex-col">
    <!-- 顶栏 -->
    <header class="relative border-b border-ink-700 bg-ink-850/80 backdrop-blur-sm sticky top-0 z-20 tc-scanline">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-neon to-violet flex items-center justify-center">
            <span class="text-ink-950 font-bold text-sm">T</span>
          </div>
          <span class="font-semibold text-slate-100 tracking-tight">ToneCore</span>
          <span class="tc-badge hidden sm:inline-flex">v0.1.0</span>
        </div>

        <nav class="ml-auto hidden md:flex items-center gap-1">
          <button v-for="t in tabs" :key="t.id"
            class="px-3 py-1.5 rounded-md text-sm transition-colors"
            :class="tab === t.id ? 'bg-ink-700 text-neon-soft' : 'text-slate-500 hover:text-slate-300'"
            @click="tab = t.id">
            {{ t.label }}
          </button>
        </nav>

        <div class="ml-auto md:ml-0 flex items-center gap-2">
          <span class="tc-dot" :class="health?.ok ? 'tc-dot-ok' : 'tc-dot-off'"></span>
          <span class="text-xs text-slate-500 hidden sm:inline">
            {{ health?.ok ? '在线' : '离线' }}
          </span>
        </div>
      </div>
    </header>

    <!-- 移动端底部 Tab -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 py-5 pb-20 md:pb-5">
      <Dashboard v-if="tab === 'dash'" :health="health" />
      <Sources   v-else-if="tab === 'sources'" />
      <Library   v-else-if="tab === 'library'" />
      <Settings  v-else />
    </main>

    <nav class="md:hidden fixed bottom-0 inset-x-0 border-t border-ink-700 bg-ink-850/95 backdrop-blur z-20">
      <div class="grid grid-cols-4">
        <button v-for="t in tabs" :key="t.id"
          class="py-2.5 flex flex-col items-center gap-0.5 transition-colors"
          :class="tab === t.id ? 'text-neon' : 'text-slate-600'"
          @click="tab = t.id">
          <span class="text-lg leading-none">{{ t.icon }}</span>
          <span class="text-[10px]">{{ t.label }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from './composables/useApi.js';
import Dashboard from './views/Dashboard.vue';
import Sources from './views/Sources.vue';
import Library from './views/Library.vue';
import Settings from './views/Settings.vue';

const tabs = [
  { id: 'dash',    label: '总览',   icon: '◈' },
  { id: 'sources', label: '音源',   icon: '◉' },
  { id: 'library', label: '曲库',   icon: '▤' },
  { id: 'settings',label: '设置',   icon: '⚙' },
];
const tab = ref('dash');
const health = ref(null);

onMounted(async () => {
  health.value = await api.health();
  setInterval(async () => { health.value = await api.health(); }, 10000);
});
</script>
