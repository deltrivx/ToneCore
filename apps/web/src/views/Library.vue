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

    <!-- ============ 在线推荐（榜单）============
         曲库小的时候，本地那几个维度很快就没什么可推荐，所以补在线源。
         点卡片走在线播放链路（与在线搜索一致），不落库。 -->
    <template v-if="boards.length">
      <section v-for="b in boards" :key="b.id" class="space-y-2">
        <h3 class="tc-section-title">推荐 · {{ b.name }}</h3>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          <div v-for="(s, i) in b.items" :key="s.id || i"
            class="group cursor-pointer" @click="playRecommend(b, i)">
            <div class="relative tc-cover-art">
              <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
                <Icon name="music" :size="22" />
              </div>
              <button class="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/55"
                :title="`播放 ${s.title}`">
                <span class="w-8 h-8 rounded-full bg-accent text-fg-inverse flex items-center justify-center">
                  <Icon name="play" :size="14" />
                </span>
              </button>
            </div>
            <div class="mt-1 text-[11px] text-fg truncate">{{ s.title }}</div>
            <div class="text-[10px] text-fg-subtle truncate">{{ s.artist }}</div>
          </div>
        </div>
      </section>
    </template>

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
import Icon from '../components/Icon.vue';

const player = usePlayer();

const onlineKwInput = ref('');
const onlineKw = ref('');
const onlineSearching = ref(false);

/** 在线推荐（榜单）。拿不到就留空，不影响云端搜索 */
const boards = ref([]);
const message = ref(null);

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

onMounted(() => { loadRecommend(); });
</script>
