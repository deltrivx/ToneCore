<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">音源</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          共 <span class="text-neon-soft font-mono">{{ sources.length }}</span> 个脚本
          <span v-if="failedCount" class="text-rose-400">
            · <span class="font-mono">{{ failedCount }}</span> 个加载失败
          </span>
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="tc-btn text-xs" :disabled="loading" @click="openImport">导入脚本</button>
        <button class="tc-btn text-xs" :disabled="loading" @click="reload">
          {{ loading ? '加载中…' : '重新加载' }}
        </button>
      </div>
    </div>

    <!-- 导入面板 -->
    <div v-if="importOpen" class="tc-card p-4 space-y-3">
      <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">导入音源脚本</div>
      <div>
        <label class="tc-label">文件名（须以 .js 结尾）</label>
        <input v-model="importForm.filename" class="tc-input font-mono text-xs" placeholder="例如：我的音源.js" />
      </div>
      <div>
        <label class="tc-label">脚本内容</label>
        <textarea v-model="importForm.content" rows="8" class="tc-input font-mono text-[11px]"
          placeholder="粘贴洛雪音源脚本内容（需含 module.exports）"></textarea>
      </div>
      <div class="text-xs text-slate-600">
        也可直接把 .js 文件放进容器数据目录的 <code class="tc-badge">sources/</code> 后点重新加载。
      </div>
      <div class="flex gap-2">
        <button class="tc-btn-primary text-xs" :disabled="busy" @click="doImport">
          {{ busy ? '导入中…' : '导入并加载' }}
        </button>
        <button class="tc-btn text-xs" @click="importOpen = false">取消</button>
      </div>
    </div>

    <!-- 全局提示 -->
    <div v-if="msg" class="tc-card p-3 text-xs" :class="msg.ok ? 'text-emerald-400' : 'text-rose-400'">
      {{ msg.text }}
    </div>

    <!-- 空态 -->
    <div v-if="!sources.length && !loading" class="tc-card p-8 text-center text-sm text-slate-600">
      尚未加载音源脚本<br />
      <span class="text-xs">点上方「导入脚本」，或把洛雪 <code class="tc-badge">.js</code> 音源放入 <code class="tc-badge">sources/</code> 后重新加载</span>
    </div>

    <!-- 音源列表 -->
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="s in sources" :key="s.file"
        class="tc-card p-3.5 space-y-2.5"
        :class="s.loadState === 'failed' ? 'border-rose-500/30' : ''">

        <!-- 头部：名称 + 状态点 -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm text-slate-200 truncate" :title="s.name">{{ s.name }}</div>
            <div class="text-[10px] text-slate-600 font-mono truncate">{{ s.file }}</div>
          </div>
          <span class="shrink-0 mt-0.5 w-2 h-2 rounded-full"
            :class="statusDot(s)"></span>
        </div>

        <!-- 平台标签 -->
        <div v-if="s.platforms && s.platforms.length" class="flex flex-wrap gap-1.5">
          <span v-for="p in s.platforms" :key="p" class="tc-badge text-[10px]">{{ p }}</span>
        </div>

        <!-- 状态区（无论正常与否都显示） -->
        <div class="rounded-md px-2.5 py-2 text-[11px] leading-relaxed"
          :class="s.loadState === 'failed' ? 'bg-rose-500/10 text-rose-300' : statusBox(s)">
          <div class="flex items-center gap-1.5">
            <span class="font-medium">{{ statusText(s) }}</span>
            <span v-if="s.loadState !== 'failed' && s.healthDetail && s.healthDetail.success + s.healthDetail.failure > 0"
              class="font-mono opacity-70">
              成功率 {{ rate(s.healthDetail) }}%
            </span>
          </div>
          <div v-if="s.loadState === 'failed'" class="mt-1 opacity-90 break-words">
            原因：{{ s.loadError || 未知原因 }}
          </div>
          <div v-else-if="s.healthDetail && s.healthDetail.consecutiveFailures >= 3"
            class="mt-1 opacity-90">
            原因：连续失败 {{ s.healthDetail.consecutiveFailures }} 次，已临时熔断
          </div>
          <div v-else-if="s.healthDetail && s.healthDetail.failure > 0 && s.healthDetail.success === 0"
            class="mt-1 opacity-90">
            原因：尚未成功取链，源站可能限流或已变动
          </div>
          <div v-else-if="!s.healthDetail || (s.healthDetail.success + s.healthDetail.failure === 0)"
            class="mt-1 opacity-70">
            提示：已加载，尚未使用过（无健康数据）
          </div>
        </div>

        <!-- 单源测试结果 -->
        <div v-if="testResult[s.file]" class="text-[11px] rounded-md px-2.5 py-1.5"
          :class="testResult[s.file].ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'">
          {{ testResult[s.file].text }}
        </div>

        <!-- 操作栏 -->
        <div class="flex flex-wrap gap-1.5 pt-0.5">
          <button class="tc-btn text-[11px] px-2 py-1" :disabled="busy" @click="test(s)">
            {{ busy === s.file ? '测试中…' : '测试' }}
          </button>
          <button v-if="s.loadState !== 'failed'" class="tc-btn text-[11px] px-2 py-1" :disabled="busy"
            @click="toggle(s, false)">停用</button>
          <button class="tc-btn text-[11px] px-2 py-1 text-rose-400" :disabled="busy"
            @click="remove(s)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const sources = ref([]);
const loading = ref(false);
const busy = ref(null);
const msg = ref(null);
const importOpen = ref(false);
const importForm = ref({ filename: "", content: "" });
const testResult = ref({});

const failedCount = computed(() => sources.value.filter(s => s.loadState === 'failed').length);

function statusDot(s) {
  if (s.loadState === 'failed') return 'bg-rose-500';
  const h = s.healthDetail;
  if (h && h.consecutiveFailures >= 3) return 'bg-amber-400';
  if (h && h.failure > 0 && h.success === 0) return 'bg-amber-400';
  if (h && h.success > 0) return 'bg-emerald-400';
  return 'bg-slate-500';
}

function statusBox(s) {
  const h = s.healthDetail;
  if (h && h.consecutiveFailures >= 3) return 'bg-amber-500/10 text-amber-300';
  if (h && h.failure > 0 && h.success === 0) return 'bg-amber-500/10 text-amber-300';
  if (h && h.success > 0) return 'bg-emerald-500/10 text-emerald-300';
  return 'bg-ink-800/60 text-slate-400';
}

function statusText(s) {
  if (s.loadState === 'failed') return '加载失败';
  const h = s.healthDetail;
  if (!h || h.success + h.failure === 0) return '待验证';
  if (h.consecutiveFailures >= 3) return '已熔断';
  if (h.success === 0) return '不可用';
  if (h.failure === 0) return '正常';
  return '部分可用';
}

function rate(h) {
  const t = h.success + h.failure;
  return t ? Math.round(h.success / t * 100) : 0;
}

async function load() {
  loading.value = true;
  try {
    const r = await api.sourcesAll();
    sources.value = (r && r.sources) || [];
  } catch (e) {
    msg.value = { ok: false, text: '读取音源失败：' + e };
  } finally { loading.value = false; }
}

async function reload() {
  loading.value = true; msg.value = null;
  try {
    await api.reloadSources();
    await load();
    msg.value = { ok: true, text: '已重新加载音源' };
  } catch (e) {
    msg.value = { ok: false, text: '重新加载失败：' + e };
  } finally { loading.value = false; }
}

function openImport() {
  importOpen.value = true;
  importForm.value = { filename: "", content: "" };
}

async function doImport() {
  if (!importForm.value.filename.trim() || !importForm.value.content.trim()) {
    msg.value = { ok: false, text: '请填写文件名与脚本内容' };
    return;
  }
  busy.value = 'import'; msg.value = null;
  try {
    const r = await api.sourceUpload(importForm.value.filename.trim(), importForm.value.content);
    if (r && r.ok) {
      importOpen.value = false;
      await load();
      msg.value = { ok: true, text: '导入成功，请在上方查看状态' };
    } else {
      msg.value = { ok: false, text: '导入失败：' + ((r && r.error) || '未知错误') };
    }
  } catch (e) {
    msg.value = { ok: false, text: '导入失败：' + e };
  } finally { busy.value = null; }
}

async function toggle(s, enabled) {
  busy.value = s.file; msg.value = null;
  try {
    const r = await api.sourceToggle(s.file, enabled);
    if (r && r.ok) { await load(); msg.value = { ok: true, text: '已' + (enabled ? '启用' : '停用') + ' ' + s.name }; }
    else { msg.value = { ok: false, text: '操作失败：' + ((r && r.error) || '未知错误') }; }
  } catch (e) {
    msg.value = { ok: false, text: '操作失败：' + e };
  } finally { busy.value = null; }
}

async function remove(s) {
  busy.value = s.file; msg.value = null;
  try {
    const r = await api.sourceDelete(s.file);
    if (r && r.ok) { await load(); msg.value = { ok: true, text: '已删除 ' + s.name + '（可在 _trash/ 找回）' }; }
    else { msg.value = { ok: false, text: '删除失败：' + ((r && r.error) || '未知错误') }; }
  } catch (e) {
    msg.value = { ok: false, text: '删除失败：' + e };
  } finally { busy.value = null; }
}

async function test(s) {
  busy.value = s.file; msg.value = null;
  try {
    const r = await api.sourceTest(s.file, 测试);
    const ok = !!(r && r.ok);
    testResult.value[s.file] = {
      ok,
      text: ok
        ? '测试通过：' + r.songs + ' 条 / ' + r.ms + 'ms' + (r.sample ? ' · ' + r.sample : '')
        : '测试未通过：' + ((r && r.error) || '未知原因'),
    };
    await load();
  } catch (e) {
    testResult.value[s.file] = { ok: false, text: '测试失败：' + e };
  } finally { busy.value = null; }
}

onMounted(load);
</script>
