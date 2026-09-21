<template>
  <div class="h-full flex overflow-hidden">
    <!-- ============ 侧边栏（PC 常驻 / 移动端抽屉） ============ -->
    <!-- 移动端遮罩 -->
    <div v-if="drawerOpen" class="fixed inset-0 z-30 bg-black/60 md:hidden"
         @click="drawerOpen = false"></div>

    <aside
      class="fixed md:static inset-y-0 left-0 z-40 w-[232px] shrink-0
             flex flex-col border-r border-ink-700 bg-ink-850
             transition-transform duration-250 md:translate-x-0"
      :class="drawerOpen ? 'translate-x-0' : '-translate-x-full'">

      <!-- 品牌 -->
      <div class="h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-ink-700">
        <!-- 用 :src 绑定而非静态 src：icon.png 由容器运行时从 assets/ 拷到 public/，
             构建期 Vite 里并不存在这个文件，静态引用会让构建失败 -->
        <img :src="ICON" alt="ToneCore" class="w-7 h-7 rounded-lg" />
        <span class="font-semibold text-slate-100 tracking-tight">ToneCore</span>
        <span v-if="health?.version" class="tc-badge ml-auto text-[10px]">v{{ health.version }}</span>
      </div>

      <!-- 主导航 -->
      <nav class="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div v-for="item in navItems" :key="item.id"
          class="relative tc-nav-item"
          :class="{ 'tc-nav-item-active': route === item.id }"
          @click="go(item.id)">
          <span class="w-4 text-center text-base leading-none">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <!-- 正在播放的跳动指示 -->
          <span v-if="item.id === 'now' && player.state.playing" class="tc-bars ml-auto">
            <i></i><i></i><i></i>
          </span>
          <span v-else-if="item.id === 'now' && player.state.queue.length"
                class="ml-auto text-[10px] font-mono text-slate-600">
            {{ player.state.queue.length }}
          </span>
        </div>
      </nav>

      <!-- 底部状态 -->
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
      <!-- 顶栏（移动端显汉堡 + 标题） -->
      <header class="h-14 shrink-0 border-b border-ink-700 bg-ink-850/80 backdrop-blur
                     flex items-center gap-3 px-3 md:px-5">
        <button class="md:hidden tc-icon-btn w-8 h-8 shrink-0" @click="drawerOpen = true">☰</button>
        <h1 class="text-sm font-medium text-slate-300 truncate">{{ pageTitle }}</h1>

        <div class="ml-auto flex items-center gap-2">
          <!-- 全局搜索入口 -->
          <button class="tc-icon-btn w-8 h-8" title="搜索" @click="go('search')">🔍</button>
        </div>
      </header>

      <!-- 内容区：底部留出播放条高度 -->
      <main class="flex-1 min-h-0 overflow-y-auto"
            :class="player.state.playUrl || player.state.queue.length ? 'pb-[76px] md:pb-[76px]' : ''">
        <div class="px-3 md:px-5 py-4">
          <NowPlaying v-if="route === 'now'" />
          <SearchView v-else-if="route === 'search'" />
          <Library v-else-if="route === 'library'" />
          <Sources v-else-if="route === 'sources'" />
          <Dashboard v-else-if="route === 'dash'" :health="health" />
          <Settings v-else />
        </div>
      </main>

      <!-- 迷你播放条（有队列时常驻） -->
      <MiniPlayer v-if="player.state.queue.length" />

      <!-- 移动端底部 Tab（仅主导航，PC 隐藏） -->
      <nav class="md:hidden shrink-0 border-t border-ink-700 bg-ink-850/95 backdrop-blur">
        <div class="grid grid-cols-5">
          <button v-for="item in mobileItems" :key="item.id"
            class="py-2 flex flex-col items-center gap-0.5 transition-colors"
            :class="route === item.id ? 'text-neon' : 'text-slate-600'"
            @click="go(item.id)">
            <span class="text-lg leading-none">{{ item.icon }}</span>
            <span class="text-[10px]">{{ item.label }}</span>
          </button>
        </div>
      </nav>
    </div>

    <!-- 全屏播放页 -->
    <FullPlayer v-if="player.state.expanded" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from './composables/useApi.js';
import { usePlayer } from './composables/usePlayer.js';
import NowPlaying from './views/NowPlaying.vue';
import SearchView from './views/SearchView.vue';
import Dashboard from './views/Dashboard.vue';
import Sources from './views/Sources.vue';
import Library from './views/Library.vue';
import Settings from './views/Settings.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import FullPlayer from './components/FullPlayer.vue';

/**
 * 导航命名对齐主流音乐播放器：
 *   正在播放 / 搜索 / 音乐库 / 音源 / 状态 / 设置
 * 旧版把「总览」放首位、配置藏在右上角，操作路径长且不符合听歌习惯。
 */
const navItems = [
  { id: 'now',     label: '正在播放', icon: '♫' },
  { id: 'search',  label: '搜索',     icon: '⌕' },
  { id: 'library', label: '音乐库',   icon: '▤' },
  { id: 'sources', label: '音源',     icon: '◉' },
  { id: 'dash',    label: '运行状态', icon: '◈' },
  { id: 'settings',label: '设置',     icon: '⚙' },
];

/** 移动端底部只放最常用的五个 */
const mobileItems = navItems.filter((i) => i.id !== 'dash');

const player = usePlayer();
const route = ref('now');           // 默认页 = 正在播放（用户要求）
const drawerOpen = ref(false);
const health = ref(null);

/** 图标由服务端 /icon.png 提供（容器运行时从 assets/ 拷入 public/） */
const ICON = '/icon.png';

const pageTitle = computed(() => navItems.find((i) => i.id === route.value)?.label || 'ToneCore');

function go(id) {
  route.value = id;
  drawerOpen.value = false;
  // 移动端切页时滚回顶部，否则会停在上一个页面的滚动位置
  document.querySelector('main')?.scrollTo({ top: 0 });
}

onMounted(async () => {
  await player.init();
  health.value = await api.health();
  setInterval(async () => { health.value = await api.health(); }, 10000);
});
</script>
