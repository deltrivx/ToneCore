<template>
  <!-- 未登录：只显示登录页 -->
  <Login v-if="!loggedIn" @ok="onLogin" />

  <div v-else class="tc-app">
    <!-- ============ 侧栏（桌面常驻；移动端不渲染，避免与底部 Tab 双重导航） ============ -->
    <aside class="tc-sidebar">
      <div class="tc-brand">
        <img :src="ICON" alt="ToneCore" class="w-8 h-8 rounded-lg" />
        <span class="tc-brand-name">ToneCore</span>
        <span v-if="health?.version" class="tc-chip ml-auto font-mono text-[10px]">v{{ health.version }}</span>
      </div>

      <nav class="tc-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="tc-nav-item"
          :class="{ 'tc-nav-item-active': route === item.id }"
          @click="go(item.id)"
        >
          <Icon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
          <!-- 播放中指示挂在「主页」上（正在播放的曲目在那里） -->
          <span v-if="item.id === 'home' && player.state.playing" class="tc-bars ml-auto">
            <i></i><i></i><i></i>
          </span>
        </button>
      </nav>

      <!-- 运行状态折叠在侧栏底部，不单独占导航位 -->
      <div class="tc-sidebar-foot">
        <div class="tc-status">
          <span class="tc-dot" :class="health?.ok ? 'tc-dot-ok' : 'tc-dot-off'"></span>
          <span>{{ health?.ok ? '中枢在线' : '中枢离线' }}</span>
        </div>
        <div class="tc-stats">
          <span>{{ health?.sources ?? '-' }} 音源</span>
          <span>{{ health?.library ?? '-' }} 曲目</span>
        </div>
      </div>
    </aside>

    <!-- ============ 主区 ============ -->
    <div class="tc-main">
      <header class="tc-topbar">
        <!-- 移动端：无抽屉，这里放品牌标记占位 -->
        <img :src="ICON" alt="" class="w-7 h-7 rounded-md md:hidden" />
        <h1 class="tc-topbar-title">{{ pageTitle }}</h1>
        <div class="ml-auto flex items-center gap-1">
          <button
            class="tc-icon-btn"
            title="刷新运行状态"
            @click="refreshHealth"
          >
            <Icon name="refresh" :size="17" />
          </button>
        </div>
      </header>

      <main class="tc-content">
        <div class="tc-page">
          <Home v-if="route === 'home'" />
          <Library v-else-if="route === 'library'" />
          <Sources v-else-if="route === 'sources'" />
          <Settings v-else />
        </div>
      </main>
    </div>

    <!-- ============ 入库 / 下载进度面板（浮在播放条上方，不遮挡它） ============ -->
    <div v-if="dlVisible"
      class="fixed right-3 md:right-5 z-40 w-[min(340px,calc(100vw-1.5rem))]
             rounded-lg border border-line bg-surface-raised/95 backdrop-blur shadow-lg overflow-hidden
             bottom-[132px] md:bottom-[80px]">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-line">
        <Icon name="download" :size="14" class="text-accent" />
        <span class="text-xs font-medium text-fg">入库进度</span>
        <span v-if="dlActive" class="tc-chip text-[10px]">{{ dlActive }} 个进行中</span>
        <button class="tc-icon-btn tc-icon-btn-sm ml-auto" title="收起" @click="dlDismissed = true">
          <Icon name="x" :size="13" />
        </button>
      </div>

      <div class="max-h-[240px] overflow-y-auto divide-y divide-line">
        <div v-for="t in dlTasks" :key="t.id" class="px-3 py-2 space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-xs text-fg truncate flex-1">{{ t.title }}</span>
            <span class="text-[10px] tc-num shrink-0"
              :class="t.status === 'failed' ? 'text-rose-400'
                    : t.status === 'done' ? 'text-emerald-400' : 'text-fg-subtle'">
              {{ t.status === 'running'
                  ? (dlPct(t) ? dlPct(t) + '%' : fmtBytes(t.received))
                  : t.status === 'done' ? '完成' : '失败' }}
            </span>
          </div>

          <!-- 进度条：服务端未给 Content-Length 时百分比为 0，此时显示已下载字节 -->
          <div v-if="t.status === 'running'" class="h-1 rounded-full bg-white/10 overflow-hidden">
            <div class="h-full bg-accent transition-all" :style="{ width: (dlPct(t) || 0) + '%' }"></div>
          </div>
          <div v-else-if="t.status === 'failed' && t.message"
            class="text-[10px] text-rose-300 break-words">{{ t.message }}</div>
        </div>
      </div>
    </div>

    <!-- 底部常驻播放条：始终显示（无播放时为空态），点曲目区直接展开全屏播放页 -->
    <MiniPlayer />

    <!-- 移动端底部 Tab（单一导航入口） -->
    <nav class="tc-tabbar">
      <div class="tc-tabbar-inner">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="tc-tabbar-item"
          :class="route === item.id ? 'text-accent' : 'text-fg-subtle'"
          @click="go(item.id)"
        >
          <Icon :name="item.icon" :size="20" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </nav>

    <!-- 全屏播放页：由底部播放条点击展开 -->
    <FullPlayer v-if="player.state.expanded" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { api, authState, setToken } from './composables/useApi.js';
import { usePlayer } from './composables/usePlayer.js';
import Icon from './components/Icon.vue';
import Home from './views/Home.vue';
import Library from './views/Library.vue';
import Sources from './views/Sources.vue';
import Settings from './views/Settings.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import FullPlayer from './components/FullPlayer.vue';
import Login from './views/Login.vue';

/**
 * 导航保持四项（主页 / 曲库 / 音源 / 设置）。
 *
 * 布局纪律（与旧版最大的不同）：
 *   桌面 —— 侧栏导航，无底部 Tab
 *   移动 —— 底部 Tab，无抽屉侧栏
 * 两端都只有**一个**主导航入口，避免旧版「抽屉 + 底部 Tab + 播放条」三重叠加。
 */
const navItems = [
  { id: 'home',     label: '主页', icon: 'home' },
  { id: 'library',  label: '曲库', icon: 'disc' },
  { id: 'sources',  label: '音源', icon: 'radio' },
  { id: 'settings', label: '设置', icon: 'sliders' },
];

const player = usePlayer();
const loggedIn = ref(!!authState.value.token);
const route = ref('home');
const health = ref(null);

const ICON = '/icon.png';

function onLogin() { loggedIn.value = true; }
// 令牌失效（401）时退回登录页
window.addEventListener('tc-unauthorized', () => { loggedIn.value = false; });

const pageTitle = computed(() => navItems.find((i) => i.id === route.value)?.label || 'ToneCore');

function go(id) {
  route.value = id;
  document.querySelector('main')?.scrollTo({ top: 0 });
}

async function refreshHealth() {
  health.value = await api.health();
}

// ---------- 入库 / 下载进度 ----------
//
// 此前 /api/downloads 在前端有定义却**从未被调用**：点了「入库」之后没有任何
// 可见反馈，只能等曲库数量变化才知道结果，中途卡住也看不出来。
const downloads = ref({ tasks: [], active: 0 });
const dlDismissed = ref(false);

const dlActive = computed(
  () => (downloads.value.tasks || []).filter((t) => t.status === 'running').length,
);

/** 进行中的排前面，已结束的按时间倒序最多留 4 条 */
const dlTasks = computed(() => {
  const list = downloads.value.tasks || [];
  const running = list.filter((t) => t.status === 'running');
  const rest = list
    .filter((t) => t.status !== 'running')
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, 4);
  return [...running, ...rest];
});

const dlVisible = computed(
  () => dlTasks.value.length > 0 && (dlActive.value > 0 || !dlDismissed.value),
);

function dlPct(t) {
  if (!t.total) return 0;
  return Math.min(100, Math.round((t.received / t.total) * 100));
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

async function loadDownloads() {
  try {
    const r = await api.downloads();
    if (r) downloads.value = { tasks: r.queue?.tasks || [], active: r.queue?.active || 0 };
  } catch { /* 拉取失败不影响主界面 */ }
}

// 有新的下载活动时自动重新展开，避免用户错过进度
watch(dlActive, (n) => { if (n > 0) dlDismissed.value = false; });

onMounted(async () => {
  // 有令牌先校验一次，避免拿着过期令牌进主界面后满屏 401
  if (authState.value.token) {
    const me = await api.v1Me();
    if (!me || !me.username) { loggedIn.value = false; setToken(''); }
  }
  await player.init();
  await refreshHealth();
  await loadDownloads();
  setInterval(refreshHealth, 10000);
  // 下载进度需要更实时，单独用更短的间隔轮询
  setInterval(loadDownloads, 2500);
});
</script>
