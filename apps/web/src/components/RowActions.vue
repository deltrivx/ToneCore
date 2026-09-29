<template>
  <div ref="root" class="relative shrink-0">
    <!-- 触发按钮：功能性操作统一收进这里，以后加功能只往 items 里加一项 -->
    <button
      class="tc-icon-btn tc-icon-btn-sm"
      :class="always ? 'opacity-60 md:opacity-0 md:group-hover:opacity-100' : ''"
      :title="label"
      :disabled="busy"
      @click.stop="toggle">
      <Icon :name="busy ? 'clock' : icon" :size="14" />
    </button>

    <!-- 下拉菜单 -->
    <div v-if="open"
      class="absolute right-0 z-50 mt-1 min-w-[168px] py-1 rounded-md border border-line bg-surface-overlay shadow-lg"
      @click.stop>
      <button v-for="it in items" :key="it.label"
        class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
        :class="it.danger
          ? 'text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-300'
          : 'text-fg hover:bg-white/[0.06]'"
        :disabled="it.disabled"
        @click="pick(it)">
        <Icon :name="it.icon" :size="14" class="shrink-0" />
        <span class="truncate">{{ it.label }}</span>
        <span v-if="it.hint" class="ml-auto text-[10px] text-fg-subtle shrink-0">{{ it.hint }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';

/**
 * 行级「更多操作」菜单。
 *
 * 为什么把功能按钮收进来：
 *   此前每个功能各占一个按钮（详情、删除、加入队列…），列表行已经被挤满，
 *   再加功能就没地方放了。收纳成菜单后，以后新增功能只需在 items 里加一项，
 *   不用再改每一处的布局。
 *
 * 用法：
 *   <RowActions :items="[{ label:'详情', icon:'info', run:()=>{} }]" />
 *
 * ⚠️ 菜单用了 position:absolute，父级需是 relative；
 *    点击外部与滚动都会关闭，避免弹层挂在原地挡住后面的行。
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  icon: { type: String, default: 'more' },
  label: { type: String, default: '更多操作' },
  busy: { type: Boolean, default: false },
  /** 小屏常驻、大屏收进 hover —— 触屏没有 hover，按钮不能只在悬浮时出现 */
  always: { type: Boolean, default: true },
});

const open = ref(false);
const root = ref(null);

function toggle() { open.value = !open.value; }

function pick(it) {
  open.value = false;
  if (it && typeof it.run === 'function' && !it.disabled) it.run();
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false;
}
function onEsc(e) { if (e.key === 'Escape') open.value = false; }

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onEsc);
  // 列表滚动时关闭：否则菜单会脱离原行浮在别处
  window.addEventListener('scroll', onEsc, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onEsc);
  window.removeEventListener('scroll', onEsc, true);
});
</script>
