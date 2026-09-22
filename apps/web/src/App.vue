<template>
  <!-- 未登录：只显示登录页（SongLoft 兼容层要求 /api/v1/* 带 Bearer 令牌） -->
  <Login v-if="!loggedIn" @ok="onLogin" />

  <div v-else class="h-full flex overflow-hidden">
    <!-- ============ 侧边栏（PC 常驻 / 移动端抽屉） ============ -->
    <div v-if="drawerOpen" class="fixed inset-0 z-30 bg-black/60 md:hidden" @click="drawerOpen = false"></div>

    <aside
      class="fixed md:static inset-y-0 left-0 z-40 w-[232px] shrink-0
             flex flex-col border-r border-ink-700 bg-ink-850
             transition-transform duration-250 md:translate-x-0"
      :class="drawerOpen ? 'translate-x-0' : '-translate-x-full'">

      <!-- 品牌 -->
      <div class="h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-ink-700">
        <img :src="ICON" alt="ToneCore" class="w-7 h-7 rounded-lg" />
        <span class="font-semibold text-slate-100 tracking-tight">ToneCore</span>
        <span v-if="health?.version" class="tc-badge ml-auto text-[10px]">v{{ health.version }}</span>
      </div>

      <!-- 主导航：仅四项（主页 / 曲库 / 音源 / 设置），其他功能以后再加 -->
      <nav class="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div v-for="item in navItems" :key="item.id"
          class="relative tc-nav-item"
          :class="{ 'tc-nav-item-active': route === item.id }"
          @click="go(item.id)">
          <span class="w-4 text-center text-base leading-none">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <!-- 播放状态指示挂在「主页」上（正在播放的歌单/曲目在那里） -->
          <span v-if="item.id === 'home' && player.state.playing" class="tc-bars ml-auto">
            <i></i><i></i><i></i>
          </span>
        </div>
      </nav>

      <!-- 底部状态（运行状态折叠进这里，不再单独占一个导航位） -->
      <div class="shrink-0 border-t border-ink-700 p-3 space-y-2">
        <div class="flex items-center gap-2">
          <span class="tc-dot" :class="health?.ok ? 'tc-dot-ok' : 'tc-dot-off'"></span>
          <span class="text-xs text-slate-500">{{ health?.ok ? '中枢在线' : '中枢离线' }}</span>
        </div>
        <div class="flex items-center gap-3 text-[11px] text-slate-600 font-mono">
          <span>{{ health?.sources ?? '-' }} 音源</span>
          <span>{{ health?.library ?? '-' }} 曲目</span>
        </div>
      </div>
    </aside>

    <!-- ============ 主区 ============ -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- 顶栏：仅显示当前页标题（搜索框内嵌在各页顶部，避免入口冗余） -->
      <header class="h-14 shrink-0 border-b border-ink-700 bg-ink-850/80 backdrop-blur
                     flex items-center gap-3 px-3 md:px-5">
        <button class="md:hidden tc-icon-btn w-8 h-8 shrink-0" @click="drawerOpen = true">☰</button>
        <h1 class="text-sm font-medium text-slate-300 truncate">{{ pageTitle }}</h1>
      </header>

      <!-- 内容区：底部播放条常驻，始终留出高度，避免内容被遮 -->
      <main class="flex-1 min-h-0 overflow-y-auto pb-[76px]">
        <div class="px-3 md:px-5 py-4">
          <Home v-if="route === 'home'" />
          <Library v-else-if="route === 'library'" />
          <Sources v-else-if="route === 'sources'" />
          <Settings v-else />
        </div>
      </main>

      <!-- 底部常驻播放条：始终显示（无播放时为空态），点击可上浮「正在播放」面板 -->
      <MiniPlayer />

      <!-- 移动端底部 Tab：与主导航一致的四项 -->
      <nav class="md:hidden shrink-0 border-t border-ink-700 bg-ink-850/95 backdrop-blur">
        <div class="grid grid-cols-4">
          <button v-for="item in navItems" :key="item.id"
            class="py-2 flex flex-col items-center gap-0.5 transition-colors"
            :class="route === item.id ? 'text-neon' : 'text-slate-600'"
            @click="go(item.id)">
            <span class="text-lg leading-none">{{ item.icon }}</span>
            <span class="text-[10px]">{{ item.label }}</span>
          </button>
        </div>
      </nav>
    </div>

    <!-- 上浮「正在播放」面板：点底部播放条弹出，点空白处 / 收纳按钮收起 -->
    <NowPlayingSheet v-if="player.state.sheetOpen" />

    <!-- 全屏播放页 -->
    <FullPlayer v-if="player.state.expanded" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, authState, setToken } from './composables/useApi.js';
import { usePlayer } from './composables/usePlayer.js';
import Home from './views/Home.vue';
import Library from './views/Library.vue';
import Sources from './views/Sources.vue';
import Settings from './views/Settings.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import FullPlayer from './components/FullPlayer.vue';
import NowPlayingSheet from './components/NowPlayingSheet.vue';
import Login from './views/Login.vue';

/**
 * 导航收敛为四项，对齐主流音乐播放器（Navidrome / SongLoft 的主流结构）：
 *   主页   —— 本地歌曲（默认落地页）
 *   曲库   —— 检索、详情、刮削与歌单
 *   音源   —— 音源脚本管理
 *   设置   —— 中枢参数 / 小爱音箱接入 / 关于
 *
 * 播放相关的界面统一放在「底部常驻播放条 + 上浮面板」，不再占用主页版面。
 * 「运行状态」折叠进侧栏底部状态条；「联网搜索」不再单独成页，改为各页顶部搜索框。
 */
const navItems = [
  { id: 'home',    label: '主页',   icon: '♫' },
  { id: 'library', label: '曲库',   icon: '▤' },
  { id: 'sources', label: '音源',   icon: '◉' },
  { id: 'settings',label: '设置',   icon: '⚙' },
];

const player = usePlayer();
const loggedIn = ref(!!authState.value.token);
const route = ref('home');

function onLogin() { loggedIn.value = true; }
// 令牌失效（401）时退回登录页
window.addEventListener('tc-unauthorized', () => { loggedIn.value = false; });

const drawerOpen = ref(false);
const health = ref(null);

const ICON = '/icon.png';

const pageTitle = computed(() => navItems.find((i) => i.id === route.value)?.label || 'ToneCore');

function go(id) {
  route.value = id;
  drawerOpen.value = false;
  document.querySelector('main')?.scrollTo({ top: 0 });
}

onMounted(async () => {
  // 有令牌先校验一次，避免拿着过期令牌进主界面后满屏 401
  if (authState.value.token) {
    const me = await api.v1Me();
    if (!me || !me.username) { loggedIn.value = false; setToken(''); }
  }
  await player.init();
  health.value = await api.health();
  setInterval(async () => { health.value = await api.health(); }, 10000);
});
</script>
