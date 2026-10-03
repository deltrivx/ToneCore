<template>
  <div class="space-y-5">
    <!-- ============ 顶部：云端搜索（本页只搜云端；本地歌曲去「主页」） ============ -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <Icon name="search" :size="15"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
        <input v-model="onlineKwInput" class="tc-input pl-9"
          placeholder="搜索云端歌曲 / 歌手（回车）" @keyup.enter="doOnlineSearch" />
      </div>
      <button class="tc-btn-primary shrink-0" :disabled="onlineSearching" @click="doOnlineSearch">
        <Icon name="search" :size="14" />
        <span>{{ onlineSearching ? '搜索中…' : '云端搜索' }}</span>
      </button>
    </div>

    <!-- 在线结果（内联，不跳页） -->
    <OnlineSearch v-if="onlineKw" :keyword="onlineKw" />

    <!--
      本地曲库已按用户要求整体迁到「主页」。
      本页（曲库）只负责两件事：云端搜歌入库 + 在线推荐。
      职责分开后，两个页面的搜索框也不再语义混淆。
    -->

    <!-- ============ 我的网易云歌单 ============
         服务端接口（/api/netease/playlists）早已就绪，此前只是没有界面消费它 ——
         这就是「未实现我的歌单」的真因：缺 UI，不缺接口。
         参考飞牛的 nmplaylists：只读注入，不回写网易。 -->
    <template v-if="myPlaylists.length">
      <section class="space-y-2">
        <h3 class="tc-section-title">
          我的网易云歌单
          <span class="ml-1.5 text-[10px] text-fg-subtle align-middle font-normal">只读 · 不会改动你的网易账号</span>
        </h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div v-for="pl in myPlaylists" :key="pl.id"
            class="group cursor-pointer" @click="openPlaylist(pl)">
            <div class="relative tc-cover-art">
              <img v-if="pl.coverUrl" :src="pl.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
                <Icon name="music" :size="30" />
              </div>
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
                :title="`打开 ${pl.name}`">
                <span class="rounded-full bg-accent text-fg-inverse w-10 h-10 flex items-center justify-center">
                  <Icon name="play" :size="16" />
                </span>
              </button>
            </div>
            <div class="mt-1 truncate text-sm text-fg" :title="pl.name">{{ pl.name }}</div>
            <div class="text-[10px] text-fg-subtle">{{ pl.trackCount }} 首</div>
          </div>
        </div>
      </section>
    </template>

    <!-- 歌单详情（点开后展示曲目，可播放 / 加入队列 / 入库） -->
    <template v-if="activePlaylist">
      <section class="space-y-2">
        <div class="flex items-center gap-2">
          <h3 class="tc-section-title truncate">{{ activePlaylist.name }}</h3>
          <button class="tc-btn text-xs" @click="closePlaylist">返回</button>
          <span v-if="plLoading" class="text-[11px] text-fg-subtle">加载中…</span>
        </div>
        <div class="tc-panel divide-y divide-line">
          <div v-for="(s, i) in activePlaylist.tracks" :key="s.id || i"
            class="tc-row group cursor-pointer">
            <div class="relative tc-cover tc-cover-sm">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <Icon v-else name="music" :size="14" class="text-fg-subtle" />
            </div>
            <div class="min-w-0 flex-1" @click="playTrack(i)">
              <div class="text-sm text-fg truncate">{{ s.title }}</div>
              <div class="text-xs text-fg-muted truncate">{{ s.artist || '未知歌手' }}</div>
            </div>
            <span class="text-fg-subtle truncate hidden md:inline max-w-[160px] text-xs">{{ s.album }}</span>
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-60 md:opacity-0 md:group-hover:opacity-100"
              title="播放" @click.stop="playTrack(i)">
              <Icon name="play" :size="14" />
            </button>
            <RowActions :items="rowActions(s)" :busy="busyId === s.id" @click.stop />
          </div>
        </div>
        <div v-if="activePlaylist.tracks.length === 0 && !plLoading"
          class="text-xs text-fg-subtle">这个歌单没有取到曲目（可能是无版权或接口限制）。</div>
      </section>
    </template>

    <!-- ============ 在线推荐（榜单）============
         曲库小的时候，本地那几个维度很快就没什么可推荐，所以补在线源。
         点卡片走在线播放链路（与在线搜索一致），不落库。
         支持列表 / 小图 / 大图三种显示方式（与主页面共用同一套偏好）。 -->
    <template v-if="boards.length">
      <!-- 显示方式：列表 / 小图 / 大图 -->
      <div class="flex items-center gap-2">
        <div class="inline-flex rounded-md border border-line overflow-hidden shrink-0 bg-white/[0.02]">
          <button v-for="v in VIEWS" :key="v.id"
            class="px-2.5 py-1.5 transition-colors"
            :class="view === v.id ? 'bg-accent-weak text-accent' : 'text-fg-subtle hover:text-fg'"
            :title="v.label" @click="setView(v.id)">
            <Icon :name="v.icon" :size="15" />
          </button>
        </div>
        <span class="text-[11px] text-fg-subtle">推荐显示方式</span>
      </div>

      <section v-for="b in boards" :key="b.id" class="space-y-2">
        <h3 class="tc-section-title">
          推荐 · {{ b.name }}
          <!-- 每日推荐是每天轮换的源，与固定榜单区分开 -->
          <span v-if="b.tier === 'daily'" class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-accent-weak text-accent align-middle">每日更新</span>
          <span v-if="b.desc" class="ml-1.5 text-[10px] text-fg-subtle align-middle font-normal">{{ b.desc }}</span>
        </h3>

        <!-- 列表 -->
        <div v-if="view === 'list'" class="tc-panel divide-y divide-line">
          <div v-for="(s, i) in b.items" :key="s.id || i"
            class="tc-row group cursor-pointer" @click="playRecommend(b, i)">
            <div class="relative tc-cover tc-cover-sm">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <Icon v-else name="music" :size="14" class="text-fg-subtle" />
              <div class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55 text-white">
                <Icon name="play" :size="14" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm text-fg truncate">{{ s.title }}</div>
              <div class="text-xs text-fg-muted truncate">
                {{ s.artist || '未知歌手' }}
                <!-- 网易给的推荐语，只有每日推荐才有 -->
                <span v-if="s.reason" class="text-fg-subtle"> · {{ s.reason }}</span>
              </div>
            </div>
            <span class="text-fg-subtle truncate hidden md:inline max-w-[160px] text-xs">{{ s.album }}</span>
            <!-- 播放是高频操作，留在行内（hover 浮出）；其余收进「更多」菜单。
                 以后新增功能只要往 rowActions() 里加一项，不用再挤布局。 -->
            <button class="tc-icon-btn tc-icon-btn-sm shrink-0 opacity-60 md:opacity-0 md:group-hover:opacity-100"
              title="播放试听" @click.stop="playRecommend(b, i)">
              <Icon name="play" :size="14" />
            </button>
            <RowActions :items="rowActions(s)" :busy="busyId === s.id" @click.stop />
          </div>
        </div>

        <!-- 小图 / 大图 -->
        <div v-else :class="view === 'grid-sm'
          ? 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'">
          <div v-for="(s, i) in b.items" :key="s.id || i"
            class="group cursor-pointer" @click="playRecommend(b, i)">
            <div class="relative tc-cover-art">
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
            <div class="text-[10px] text-fg-subtle truncate">{{ s.artist }}</div>
            <!-- 网格视图下收纳操作：默认隐藏，hover 浮出，避免小卡片被按钮挤满 -->
            <div class="flex items-center gap-1 mt-1 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button class="tc-icon-btn tc-icon-btn-sm" title="加入队列" @click.stop="addToQueue(s)">
                <Icon name="plus" :size="13" />
              </button>
              <button class="tc-icon-btn tc-icon-btn-sm" :disabled="busyId === s.id"
                title="下载到本地曲库" @click.stop="saveOne(s)">
                <Icon v-if="busyId === s.id" name="clock" :size="13" />
                <Icon v-else name="download" :size="13" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ============ 入库格式选择 ============
         按精确曲目 ID 入库：推荐位每首都自带 platform + id，
         直接按 ID 取链才能保住原唱（若按歌名重搜，很可能入库到翻唱版）。 -->
    <div v-if="pickQuality.open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      @click.self="closeQuality">
      <div class="tc-card w-full max-w-[380px] p-4 space-y-3">
        <div class="text-sm font-medium text-fg">选择入库音质</div>
        <div class="text-[11px] text-fg-subtle break-words">目标：{{ pickQuality.title }}</div>
        <div class="space-y-1.5">
          <label v-for="q in QUALITIES" :key="q.id"
            class="flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors"
            :class="pickQuality.quality === q.id
              ? 'border-accent/60 bg-accent-weak'
              : 'border-line hover:bg-white/[0.04]'">
            <input type="radio" name="tc-lib-quality" :value="q.id"
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
          入库后到「主页」查看；无 VIP 时无损可能被上游降级为 320k。
        </div>
      </div>
    </div>

    <!-- 轻提示 -->
    <div v-if="message" class="tc-alert" :class="message.ok ? 'tc-alert-ok' : 'tc-alert-warn'">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="15" class="mt-0.5" />
      <span>{{ message.text }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { usePlayer } from '../composables/usePlayer.js';
import OnlineSearch from '../components/OnlineSearch.vue';
import RowActions from '../components/RowActions.vue';
import Icon from '../components/Icon.vue';

const player = usePlayer();

/** 显示方式：列表 / 小图 / 大图。
 *  与主页共用同一个 localStorage key：两页是同一类内容（封面墙 / 列表），
 *  用户在一个页面调过显示方式后，另一个页面没必要再调一次。 */
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

const onlineKwInput = ref('');
const onlineKw = ref('');
const onlineSearching = ref(false);

/** 在线推荐（榜单）。拿不到就留空，不影响云端搜索 */
const boards = ref([]);
const message = ref(null);
/** 正在入库的曲目 id（用于按钮转圈与禁用，避免重复点） */
const busyId = ref(null);

async function loadRecommend() {
  try {
    const r = await api.recommend();
    boards.value = (r && r.boards) || [];
  } catch { /* 在线推荐失败不影响本页主体，静默 */ }
}

/** 在线推荐：直接走在线播放链路（与在线搜索一致），不落库 */
async function playRecommend(b, index) {
  message.value = null;
  try {
    const r = await player.playList(b.items, index);
    if (!r || r.ok === false) message.value = { ok: false, text: (r && r.error) || '暂时取不到可播放地址' };
    else if (!r.playUrl) message.value = { ok: false, text: `「${b.items[index].title}」取链失败，换一首试试` };
  } catch (e) { message.value = { ok: false, text: '播放失败：' + e }; }
}

async function doOnlineSearch() {
  const k = onlineKwInput.value.trim();
  if (!k) return;
  onlineSearching.value = true; onlineKw.value = k;
  await new Promise(r => setTimeout(r, 30));
  onlineSearching.value = false;
}

/** 加入队列（高频操作，留在行内） */
async function addToQueue(s) {
  await player.append([s]);
  message.value = { ok: true, text: `已添加到队列：${s.title}` };
}

/**
 * 入库音质。
 *
 * ⚠️ 值必须与服务端 QUALITY_WHITELIST 一致（master/flac24bit/flac/320k/128k），
 * 否则 normalizeQuality 认不出来，会静默回落到全局默认 —— 表现为「选了没生效」。
 */
const QUALITIES = [
  { id: 'flac',      label: '无损 FLAC', hint: '推荐 · 体积较大' },
  { id: 'flac24bit', label: '母带 24bit', hint: 'Hi-Res · 体积最大' },
  { id: '320k',      label: '高品质 320k', hint: '体积适中' },
  { id: '128k',      label: '标准 128k',  hint: '体积最小' },
];
const pickQuality = ref({ open: false, quality: 'flac', title: '', song: null });

function askQuality(s) {
  pickQuality.value = { open: true, quality: 'flac', title: s.title, song: s };
}
function closeQuality() {
  pickQuality.value = { open: false, quality: pickQuality.value.quality, title: '', song: null };
}

async function confirmQuality() {
  const { quality, song } = pickQuality.value;
  closeQuality();
  if (song) await saveOne(song, quality);
}

/**
 * 单曲入库：按**精确曲目 ID** 走 /api/fetch-by-id。
 *
 * 为什么不用 /api/play（keyword + artist）：推荐位每首都自带 platform + id，
 * 若退化成「按歌名重新搜一遍」，很可能入库到翻唱版 —— 与「歌词提前跑完」
 * 是同一个坑。按 ID 取链才能保住原唱。
 */
async function saveOne(s, quality = 'flac') {
  busyId.value = s.id; message.value = null;
  try {
    const r = await api.fetchById({
      platform: s.platform || 'wy',
      songId: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      coverUrl: s.coverUrl,
      duration: s.duration,
    }, quality);
    message.value = r && r.ok
      ? { ok: true, text: `已加入下载队列（${quality}）：${s.title}` }
      : { ok: false, text: `入库失败：${(r && r.error) || '取链失败'}` };
  } catch (e) {
    message.value = { ok: false, text: '入库失败：' + e };
  } finally { busyId.value = null; }
}

/**
 * 行级「更多操作」菜单项。
 * 以后新增功能：在这里加一项即可，列表行布局不用再动。
 */
function rowActions(s) {
  return [
    { label: '播放试听', icon: 'play', run: () => playRecommend({ items: [s] }, 0) },
    { label: '加入队列', icon: 'plus', run: () => addToQueue(s) },
    { label: '下载入库', icon: 'download', run: () => askQuality(s) },
    { label: '复制曲目信息', icon: 'info', run: () => copyInfo(s) },
  ];
}

/** 复制「歌名 - 歌手」，便于去别处搜索 */
async function copyInfo(s) {
  const text = `${s.title}${s.artist ? ' - ' + s.artist : ''}`;
  try {
    await navigator.clipboard.writeText(text);
    message.value = { ok: true, text: `已复制：${text}` };
  } catch {
    message.value = { ok: false, text: '复制失败（浏览器可能限制了剪贴板权限）' };
  }
}

// ---------- 我的网易云歌单（只读，不回写网易）----------
const myPlaylists = ref([]);
const activePlaylist = ref(null);
const plLoading = ref(false);
/** 是否已登录网易云：未登录时也不该显示空白区块，故单独记录 */
const neLoggedIn = ref(false);

async function loadMyPlaylists() {
  try {
    const st = await api.neteaseStatus();
    neLoggedIn.value = !!(st && st.loggedIn);
    if (!neLoggedIn.value) { myPlaylists.value = []; return; }
    const r = await api.neteasePlaylists();
    myPlaylists.value = (r && r.playlists) || [];
  } catch {
    myPlaylists.value = [];
  }
}

async function openPlaylist(pl) {
  plLoading.value = true; message.value = null;
  activePlaylist.value = { ...pl, tracks: [] };
  try {
    const r = await api.neteasePlaylistTracks(pl.id);
    activePlaylist.value.tracks = (r && r.tracks) || [];
    // 整张歌单灌进队列，才能连续播放与「下一首」
    if (activePlaylist.value.tracks.length) {
      await player.playList(activePlaylist.value.tracks, 0);
    }
  } catch (e) {
    message.value = { ok: false, text: '读取歌单失败：' + e };
  } finally { plLoading.value = false; }
}

function closePlaylist() { activePlaylist.value = null; }

async function playTrack(index) {
  const list = activePlaylist.value?.tracks || [];
  if (!list.length) return;
  message.value = null;
  try {
    const r = await player.playList(list, index);
    if (!r || r.ok === false) message.value = { ok: false, text: (r && r.error) || '暂时取不到可播放地址' };
    else if (!r.playUrl) message.value = { ok: false, text: `「${list[index].title}」取链失败，换一首试试` };
  } catch (e) {
    message.value = { ok: false, text: '播放失败：' + e };
  }
}

onMounted(() => { loadRecommend(); loadMyPlaylists(); });
</script>
