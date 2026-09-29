<template>
  <div class="space-y-4">
    <!-- ============ 入库格式选择 ============ -->
    <div v-if="pickQuality.open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      @click.self="closeQuality">
      <div class="tc-card w-full max-w-[380px] p-4 space-y-3">
        <div class="text-sm font-medium text-fg">选择入库音质</div>
        <div class="text-[11px] text-fg-subtle break-words">
          目标：{{ pickQuality.title }}
        </div>
        <div class="space-y-1.5">
          <label v-for="q in QUALITIES" :key="q.id"
            class="flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors"
            :class="pickQuality.quality === q.id
              ? 'border-accent/60 bg-accent-weak'
              : 'border-line hover:bg-white/[0.04]'">
            <input type="radio" name="tc-quality" :value="q.id"
              v-model="pickQuality.quality" class="accent-accent" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-fg">{{ q.label }}</span>
              <span class="block text-[11px] text-fg-subtle">{{ q.hint }}</span>
            </span>
          </label>
        </div>
        <div class="flex gap-2 pt-1">
          <button class="tc-btn-primary flex-1" @click="confirmQuality">开始入库</button>
          <button class="tc-btn" @click="closeQuality">取消</button>
        </div>
        <div class="text-[10px] text-fg-subtle">
          入库 = 按所选音质下载落盘并刮削标签 / 封面 / 歌词；试听不落盘。
        </div>
      </div>
    </div>

    <!-- 检索维度：歌曲 / 歌手 / 专辑 -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="inline-flex rounded-md border border-line overflow-hidden bg-white/[0.02]">
        <button v-for="t in TYPES" :key="t.id"
          class="px-3 py-1.5 text-xs transition-colors"
          :class="type === t.id ? 'bg-accent-weak text-accent' : 'text-fg-subtle hover:text-fg'"
          @click="switchType(t.id)">{{ t.label }}</button>
      </div>
      <span v-if="type !== 'song'" class="text-[11px] text-fg-subtle">
        按{{ type === 'artist' ? '歌手' : '专辑' }}检索，返回该{{ type === 'artist' ? '歌手的热门曲目' : '专辑的完整曲目' }}
      </span>
    </div>

    <!-- ============ 状态区 ============ -->
    <div v-if="!keyword" class="tc-empty">
      <div class="tc-empty-icon"><Icon name="cloud" :size="22" /></div>
      <div class="tc-empty-title">输入关键词，联网搜索各平台音乐</div>
    </div>
    <div v-else-if="loading" class="tc-empty">
      <div class="tc-empty-icon"><Icon name="search" :size="22" /></div>
      <div class="tc-empty-title">搜索中…</div>
    </div>
    <div v-else-if="!total" class="tc-empty">
      <div class="tc-empty-icon"><Icon name="search" :size="22" /></div>
      <div class="tc-empty-title">没有搜到「{{ keyword }}」的在线结果</div>
      <div class="tc-empty-desc">可到「音源」页确认音源脚本已加载</div>
    </div>

    <template v-else>
      <!-- 汇总操作 + 显示方式：一次把全部结果存进本地曲库 -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-fg-muted">共 <b class="tc-num text-accent">{{ total }}</b> 条结果</span>
        <button class="tc-btn text-xs" :disabled="busy" @click="askQuality('全部结果', (q) => saveAll(q))">
          <Icon name="download" :size="14" />
          <span>{{ busy === 'all' ? '入库中…' : '全部入库' }}</span>
        </button>
        <span class="text-[11px] text-fg-subtle">入库 = 下载到本地曲库（可在「主页」离线播放）</span>

        <!-- 显示方式：列表 / 小图 / 大图（与主页、推荐共用同一偏好） -->
        <div class="inline-flex rounded-md border border-line overflow-hidden shrink-0 bg-white/[0.02] ml-auto">
          <button v-for="v in VIEWS" :key="v.id"
            class="px-2.5 py-1.5 transition-colors"
            :class="view === v.id ? 'bg-accent-weak text-accent' : 'text-fg-subtle hover:text-fg'"
            :title="v.label" @click="setView(v.id)">
            <Icon :name="v.icon" :size="15" />
          </button>
        </div>
      </div>

      <div v-for="(list, plat) in results" :key="plat" class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="tc-chip">{{ PLAT_LABEL[plat] || String(plat).toUpperCase() }}</span>
          <span class="text-xs tc-num text-fg-subtle">{{ list.length }} 首</span>
          <button class="tc-btn-ghost text-[11px] ml-auto" :disabled="busy"
            @click="askQuality(`${PLAT_LABEL[plat] || plat} 全部`, (q) => savePlatform(plat, list, q))">
            该平台全部入库
          </button>
        </div>

        <!-- 列表 -->
        <div v-if="view === 'list'" class="tc-panel divide-y divide-line">
          <div v-for="(s, i) in list" :key="s.id || i" class="tc-row group">
            <div class="tc-cover tc-cover-sm">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <Icon v-else name="music" :size="14" class="text-fg-subtle" />
            </div>
            <div class="min-w-0 flex-1 cursor-pointer" @click="play(list, i)">
              <div class="text-sm text-fg truncate">{{ s.title }}</div>
              <div class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-fg-subtle truncate hidden md:inline max-w-[130px] text-xs cursor-pointer"
              @click="play(list, i)">{{ s.album }}</span>

            <button class="tc-icon-btn tc-icon-btn-sm shrink-0" title="播放试听" @click="play(list, i)">
              <Icon name="play" :size="14" />
            </button>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0" title="加入队列" @click="add(s)">
              <Icon name="plus" :size="14" />
            </button>
            <button class="tc-btn text-[11px] px-2 py-1 shrink-0" :disabled="busy"
              title="下载到本地曲库" @click="askQuality(s.title, (q) => saveOne(s, q))">
              <Icon v-if="busy === key(plat, s)" name="clock" :size="13" />
              <Icon v-else name="download" :size="13" />
              <span>{{ busy === key(plat, s) ? '…' : '入库' }}</span>
            </button>
          </div>
        </div>

        <!-- 小图 / 大图 -->
        <div v-else :class="view === 'grid-sm'
          ? 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'">
          <div v-for="(s, i) in list" :key="s.id || i" class="group">
            <div class="relative tc-cover-art cursor-pointer" @click="play(list, i)">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
                <Icon name="music" :size="view === 'grid-sm' ? 22 : 34" />
              </div>
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
                :title="`播放 ${s.title}`">
                <span class="rounded-full bg-accent text-fg-inverse flex items-center justify-center"
                  :class="view === 'grid-sm' ? 'w-8 h-8' : 'w-11 h-11'">
                  <Icon name="play" :size="view === 'grid-sm' ? 14 : 18" />
                </span>
              </button>
            </div>
            <div class="mt-1 truncate"
              :class="view === 'grid-sm' ? 'text-[11px] text-fg-muted' : 'text-sm text-fg'"
              :title="s.title">{{ s.title }}</div>
            <div class="text-[10px] text-fg-subtle truncate">{{ s.artist || '未知歌手' }}</div>

            <!-- 网格视图下收纳操作：默认隐藏，hover 浮出，避免小卡片被按钮挤满 -->
            <div class="flex gap-1 mt-1 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button class="tc-icon-btn tc-icon-btn-sm" title="加入队列" @click.stop="add(s)">
                <Icon name="plus" :size="13" />
              </button>
              <button class="tc-icon-btn tc-icon-btn-sm" :disabled="busy"
                title="下载到本地曲库" @click.stop="askQuality(s.title, (q) => saveOne(s, q))">
                <Icon v-if="busy === key(plat, s)" name="clock" :size="13" />
                <Icon v-else name="download" :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="message" class="tc-alert" :class="message.ok ? 'tc-alert-ok' : 'tc-alert-warn'">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="15" class="mt-0.5" />
      <span>{{ message.text }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer } from '../composables/usePlayer.js';
import Icon from './Icon.vue';

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

/** 显示方式：列表 / 小图 / 大图。
 *  与主页、曲库推荐共用同一个 localStorage key：三处都是「封面墙 or 列表」
 *  的同类内容，用户在一处调过，其余不必再调。 */
const VIEWS = [
  { id: 'list',    label: '列表', icon: 'list' },
  { id: 'grid-sm', label: '小图', icon: 'gridSm' },
  { id: 'grid-md', label: '大图', icon: 'grid' },
];
const VIEW_KEY = 'tc.home.view';
const view = ref(localStorage.getItem(VIEW_KEY) || 'grid-md');

function setView(v) {
  view.value = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* 隐私模式忽略 */ }
}

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

/**
 * 入库音质选项。
 *
 * ⚠️ 值必须与服务端 QUALITY_WHITELIST 一致（master/flac24bit/flac/320k/128k），
 * 否则 normalizeQuality 认不出来，会静默回落成全局默认音质 ——
 * 表现为「选了格式但没生效」。
 */
const QUALITIES = [
  { id: 'flac',      label: '无损 FLAC', hint: '推荐 · 体积较大' },
  { id: 'flac24bit', label: '母带 24bit', hint: 'Hi-Res · 体积最大' },
  { id: '320k',      label: '高品质 320k', hint: '体积适中' },
  { id: '128k',      label: '标准 128k',  hint: '体积最小' },
];

/** 格式选择弹窗：待入库的目标 + 选定音质 */
const pickQuality = ref({ open: false, quality: 'flac', title: '', run: null });

/**
 * 入库前先让用户选格式。
 * 播放试听（play）不受影响 —— 试听走取链，只有「入库」才落盘。
 */
function askQuality(title, run) {
  pickQuality.value = { open: true, quality: 'flac', title, run };
}

function closeQuality() {
  pickQuality.value = { ...pickQuality.value, open: false, run: null };
}

async function confirmQuality() {
  const { quality, run } = pickQuality.value;
  closeQuality();
  if (typeof run === 'function') await run(quality);
}

/** 单曲入库：/api/play 会取链并按指定音质落盘到本地曲库 */
async function saveOne(s, quality) {
  const k = 'one:' + (s.id || s.title);
  busy.value = k; message.value = null;
  try {
    const r = await api.play(s.title, s.artist, quality);
    message.value = r && r.ok
      ? { ok: true, text: `已入库（${quality}）：${s.title}` }
      : { ok: false, text: `入库失败：${(r && r.error) || '取链失败'}` };
  } catch (e) {
    message.value = { ok: false, text: '入库失败：' + e };
  } finally { busy.value = null; }
}

async function savePlatform(plat, list, quality) {
  busy.value = 'plat:' + plat;
  await saveBatch(list, quality);
  busy.value = null;
}

async function saveAll(quality) {
  busy.value = 'all';
  const all = Object.values(results.value).flat();
  await saveBatch(all, quality);
  busy.value = null;
}

/**
 * 批量入库：逐条串行（服务端下载有并发与间隔限流，这里避免把自己打爆），
 * 实时汇报进度与成功数。
 */
async function saveBatch(list, quality) {
  let ok = 0, fail = 0;
  message.value = { ok: true, text: `开始入库 0/${list.length}（${quality}）…` };
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    try {
      const r = await api.play(s.title, s.artist, quality);
      if (r && r.ok) ok++; else fail++;
    } catch { fail++; }
    message.value = { ok: true, text: `入库进度 ${i + 1}/${list.length}（成功 ${ok}，失败 ${fail}）` };
  }
  message.value = fail
    ? { ok: false, text: `入库完成（${quality}）：成功 ${ok}，失败 ${fail}（部分曲目上游无版权）` }
    : { ok: true, text: `入库完成（${quality}）：成功 ${ok} 首，可到「主页」查看` };
}
</script>
