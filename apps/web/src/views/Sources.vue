<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">音源</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          共 <span class="text-neon-soft font-mono">{{ sources.length }}</span> 个脚本
          <span v-if="disabledCount" class="text-slate-600">
            · <span class="font-mono">{{ disabledCount }}</span> 已停用
          </span>
          <span v-if="failedCount" class="text-rose-400">
            · <span class="font-mono">{{ failedCount }}</span> 个加载失败
          </span>
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="tc-btn text-xs" :disabled="loading" @click="openImport">导入脚本</button>
        <button class="tc-btn text-xs" :disabled="busy === 'all'" @click="testAll">
          {{ busy === 'all' ? '测试中…' : '全部测试' }}
        </button>
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
          placeholder="粘贴洛雪音源脚本内容（支持 module.exports 或 globalThis.lx + send('inited') 两种写法）"></textarea>
      </div>
      <div class="text-xs text-slate-600">
        也可直接把 .js 文件放进容器数据目录的 <code class="tc-badge">sources/</code> 后点重新加载。
      </div>
      <div class="flex gap-2">
        <button class="tc-btn-primary text-xs" :disabled="busy" @click="doImport">
          {{ busy === 'import' ? '导入中…' : '导入并加载' }}
        </button>
        <button class="tc-btn text-xs" @click="importOpen = false">取消</button>
      </div>
    </div>

    <div v-if="msg" class="tc-card p-3 text-xs" :class="msg.ok ? 'text-emerald-400' : 'text-rose-400'">
      {{ msg.text }}
    </div>

    <div v-if="!sources.length && !loading" class="tc-card p-8 text-center text-sm text-slate-600">
      尚未加载音源脚本<br />
      <span class="text-xs">点上方「导入脚本」，或把洛雪 <code class="tc-badge">.js</code> 音源放入 <code class="tc-badge">sources/</code> 后重新加载</span>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="s in sources" :key="s.file"
        class="tc-card p-3.5 space-y-2.5 transition-opacity"
        :class="cardClass(s)">

        <!-- 头部：名称 + 状态点 -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm truncate" :class="s.disabled ? 'text-slate-500' : 'text-slate-200'"
              :title="s.name">{{ s.name }}</div>
            <div class="text-[10px] text-slate-600 font-mono truncate">{{ s.file }}</div>
          </div>
          <span class="shrink-0 mt-0.5 w-2 h-2 rounded-full" :class="statusDot(s)"></span>
        </div>

        <!-- 平台标签：按最近一次测试结果着色 -->
        <div v-if="badgePlatforms(s).length" class="flex flex-wrap gap-1.5">
          <span v-for="p in badgePlatforms(s)" :key="p"
            class="tc-badge text-[10px] border"
            :class="platformClass(s, p)"
            :title="platformTitle(s, p)">{{ PLAT_LABEL[p] || p }}</span>
        </div>

        <!-- 状态行：已加载 · 测试结果：正常（内联，刷新后保留） -->
        <div class="rounded-md px-2.5 py-2 text-[11px] leading-relaxed" :class="statusBoxClass(s)">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-medium">{{ statusText(s) }}</span>
            <template v-if="s.test">
              <span class="opacity-50">·</span>
              <span>测试结果：</span>
              <span class="font-medium" :class="testTextClass(s)">{{ testLabel(s) }}</span>
              <span v-if="s.test.at" class="opacity-50 font-mono">{{ relTime(s.test.at) }}</span>
            </template>
          </div>
          <div v-if="s.loadState === 'failed'" class="mt-1 opacity-90 break-words">
            原因：{{ s.loadError || '未知原因' }}
          </div>
          <div v-else-if="s.disabled" class="mt-1 opacity-80">
            不参与取链与下载，可随时启用
          </div>
          <div v-else-if="s.test && !s.test.ok && s.test.error" class="mt-1 opacity-80 break-words">
            {{ s.test.error }}
          </div>
        </div>

        <!-- 操作栏 -->
        <div class="flex flex-wrap gap-1.5 pt-0.5">
          <button class="tc-btn text-[11px] px-2 py-1" :disabled="!!busy || s.disabled || s.loadState === 'failed'"
            @click="test(s)">
            {{ busy === s.file ? '测试中…' : '测试' }}
          </button>
          <!-- 停用 / 启用：停用后卡片仍在（置灰），可随时恢复 -->
          <button v-if="!s.disabled && s.loadState !== 'failed'"
            class="tc-btn text-[11px] px-2 py-1" :disabled="!!busy" @click="setEnabled(s, false)">停用</button>
          <button v-else-if="s.disabled"
            class="tc-btn text-[11px] px-2 py-1 text-emerald-400" :disabled="!!busy" @click="setEnabled(s, true)">启用</button>
          <button class="tc-btn text-[11px] px-2 py-1 text-rose-400" :disabled="!!busy" @click="remove(s)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

/** 点「测试」时用的检索词：各平台都有的热门歌，测试才有真实信号 */
const TEST_KEYWORD = '稻香';
const PLAT_LABEL = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕', qsvip: 'QsVip', qs: 'QsVip' };

const sources = ref([]);
const loading = ref(false);
const busy = ref(null);
const msg = ref(null);
const importOpen = ref(false);
const importForm = ref({ filename: '', content: '' });

const failedCount = computed(() => sources.value.filter(s => s.loadState === 'failed').length);
const disabledCount = computed(() => sources.value.filter(s => s.disabled).length);

/** 平台徽章：优先用已加载的平台，停用时退化用测试结果里的平台 */
function badgePlatforms(s) {
  if (s.platforms && s.platforms.length) return s.platforms;
  if (s.test && s.test.platforms) return Object.keys(s.test.platforms);
  return [];
}

function platformClass(s, p) {
  if (s.disabled) return 'border-ink-600 text-slate-600';
  const t = s.test && s.test.platforms ? s.test.platforms[p] : undefined;
  if (t === true) return 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10';
  if (t === false) return 'border-rose-500/40 text-rose-400 bg-rose-500/10';
  return 'border-ink-600 text-slate-500';
}

function platformTitle(s, p) {
  const t = s.test && s.test.platforms ? s.test.platforms[p] : undefined;
  if (s.disabled) return `${PLAT_LABEL[p] || p} · 已停用`;
  if (t === true) return `${PLAT_LABEL[p] || p} · 测试正常`;
  if (t === false) return `${PLAT_LABEL[p] || p} · 测试不通过`;
  return `${PLAT_LABEL[p] || p} · 未测试`;
}

function cardClass(s) {
  if (s.disabled) return 'opacity-50 border-ink-700';
  if (s.loadState === 'failed') return 'border-rose-500/30';
  return '';
}

function statusDot(s) {
  if (s.disabled || s.loadState === 'failed') return 'bg-slate-600';
  const t = s.test ? s.test.ok : undefined;
  if (t === true) return 'bg-emerald-400';
  if (t === false) return 'bg-rose-400';
  return 'bg-slate-500';
}

function statusBoxClass(s) {
  if (s.disabled) return 'bg-ink-800/40 text-slate-500';
  if (s.loadState === 'failed') return 'bg-rose-500/10 text-rose-300';
  const t = s.test ? s.test.ok : undefined;
  if (t === true) return 'bg-emerald-500/10 text-emerald-300';
  if (t === false) return 'bg-rose-500/10 text-rose-300';
  return 'bg-ink-800/60 text-slate-400';
}

function statusText(s) {
  if (s.disabled) return '已停用';
  if (s.loadState === 'failed') return '加载失败';
  return '已加载';
}

/** 测试结论文案：正常 / 部分可用 / 不可用 */
function testLabel(s) {
  if (!s.test) return '';
  if (!s.test.ok) return '不可用';
  const ps = s.test.platforms || {};
  const bad = Object.keys(ps).filter((k) => ps[k] === false).length;
  return (bad > 0 || s.test.partial) ? '部分可用' : '正常';
}

function testTextClass(s) {
  const l = testLabel(s);
  if (l === '正常') return 'text-emerald-400';
  if (l === '部分可用') return 'text-amber-400';
  return 'text-rose-400';
}

function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return new Date(ts).toLocaleDateString();
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
  importForm.value = { filename: '', content: '' };
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
      msg.value = { ok: true, text: '导入成功' };
    } else {
      msg.value = { ok: false, text: '导入失败：' + ((r && r.error) || '未知错误') };
    }
  } catch (e) {
    msg.value = { ok: false, text: '导入失败：' + e };
  } finally { busy.value = null; }
}

async function setEnabled(s, enabled) {
  busy.value = s.file; msg.value = null;
  try {
    const r = await api.sourceToggle(s.file, enabled);
    if (r && r.ok) {
      await load();
      msg.value = { ok: true, text: `已${enabled ? '启用' : '停用'} ${s.name}` + (enabled ? '' : '（不再参与音乐下载）') };
    } else {
      msg.value = { ok: false, text: '操作失败：' + ((r && r.error) || '未知错误') };
    }
  } catch (e) {
    msg.value = { ok: false, text: '操作失败：' + e };
  } finally { busy.value = null; }
}

async function remove(s) {
  if (!confirm(`删除「${s.name}」？将移入 _trash/，可找回。`)) return;
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
    await api.sourceTest(s.file, TEST_KEYWORD);
    // 结果由服务端落盘，重新拉取即可（刷新后也保留）
    await load();
  } catch (e) {
    msg.value = { ok: false, text: '测试异常：' + (e && e.message ? e.message : String(e)) };
  } finally { busy.value = null; }
}

/** 全部测试：串行跑，避免把上游打爆 */
async function testAll() {
  busy.value = 'all'; msg.value = null;
  const list = sources.value.filter(s => !s.disabled && s.loadState !== 'failed');
  for (let i = 0; i < list.length; i++) {
    msg.value = { ok: true, text: `测试进度 ${i + 1}/${list.length}：${list[i].name}` };
    try { await api.sourceTest(list[i].file, TEST_KEYWORD); } catch { /* 单个失败不中断 */ }
  }
  await load();
  msg.value = { ok: true, text: `已测试 ${list.length} 个音源` };
  busy.value = null;
}

onMounted(load);
</script>
