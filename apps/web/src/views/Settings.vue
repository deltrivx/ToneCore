<template>
  <div class="space-y-5 max-w-2xl">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">设置</h1>
      <p class="text-sm text-slate-500 mt-0.5">中枢运行参数</p>
    </div>

    <div v-if="!cfg" class="tc-card p-6 text-sm text-slate-600">加载中…</div>

    <template v-else>
      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">落库策略</div>

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-slate-300">点播自动落库</div>
            <div class="text-xs text-slate-600 mt-0.5">播放网络歌曲时自动保存到本地</div>
          </div>
          <input type="checkbox" v-model="cfg.autoFetch"
            class="w-10 h-5 appearance-none rounded-full bg-ink-700 checked:bg-neon-dim
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-slate-300
                   before:transition-transform checked:before:translate-x-5" />
        </label>

        <div>
          <label class="tc-label">目标音质</label>
          <select v-model="cfg.quality" class="tc-input">
            <option value="master">母带 (Master)</option>
            <option value="flac24bit">Hi-Res (24bit)</option>
            <option value="flac">无损 (FLAC/SQ)</option>
            <option value="320k">高品质 (320k)</option>
            <option value="128k">标准 (128k)</option>
          </select>
        </div>

        <div>
          <label class="tc-label">落盘路径模板</label>
          <input v-model="cfg.pathTemplate" class="tc-input font-mono text-xs" />
          <div class="text-xs text-slate-600 mt-1">
            可用变量：<code class="tc-badge text-[10px]">{'{artist}'}</code>
            <code class="tc-badge text-[10px]">{'{album}'}</code>
            <code class="tc-badge text-[10px]">{'{title}'}</code>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="tc-label">下载并发</label>
            <input type="number" min="1" max="4" v-model.number="cfg.downloadConcurrency" class="tc-input" />
          </div>
          <div>
            <label class="tc-label">任务间隔 (ms)</label>
            <input type="number" min="0" step="500" v-model.number="cfg.downloadIntervalMs" class="tc-input" />
          </div>
        </div>
      </div>

      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">平台优先级</div>
        <div class="text-xs text-slate-600">越靠前越优先（拖拽排序暂未实现，直接编辑逗号分隔）</div>
        <input :value="cfg.platforms.join(', ')" class="tc-input font-mono text-xs"
          @input="e => cfg.platforms = e.target.value.split(',').map(s => s.trim()).filter(Boolean)" />
      </div>

      <div class="flex gap-2">
        <button class="tc-btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <span v-if="saved" class="self-center text-sm text-emerald-400">已保存</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const cfg = ref(null);
const saving = ref(false);
const saved = ref(false);

async function save() {
  saving.value = true; saved.value = false;
  try {
    await api.saveConfig(cfg.value);
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } finally { saving.value = false; }
}

onMounted(async () => { cfg.value = await api.config(); });
</script>
