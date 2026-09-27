<template>
  <div class="tc-card p-4 space-y-4">
    <div class="flex items-center justify-between border-b border-line pb-2">
      <div class="text-sm font-medium text-fg-muted">音箱高级配置</div>
      <span class="text-[11px] text-fg-subtle">对齐 SongLoft MIoT 插件</span>
    </div>

    <div v-if="loading" class="text-xs text-fg-subtle py-2">载入中…</div>

    <template v-else>
      <div v-for="g in GROUPS" :key="g.title" class="space-y-3">
        <div class="tc-section-title">{{ g.title }}</div>

        <template v-for="it in g.items" :key="it.key">
          <!-- 开关：整行可点 -->
          <label
            v-if="it.type === 'toggle'"
            class="flex items-center justify-between gap-4 cursor-pointer"
          >
            <div class="min-w-0">
              <div class="text-sm text-fg-muted">{{ it.label }}</div>
              <div v-if="it.desc" class="text-xs text-fg-subtle mt-0.5">{{ it.desc }}</div>
            </div>
            <input
              type="checkbox"
              v-model="form[it.key]"
              class="w-10 h-5 appearance-none rounded-full bg-surface-overlay checked:bg-accent
                     relative transition-colors cursor-pointer shrink-0
                     before:content-[''] before:absolute before:top-0.5 before:left-0.5
                     before:w-4 before:h-4 before:rounded-full before:bg-fg
                     before:transition-transform checked:before:translate-x-5"
            />
          </label>

          <!-- 数字 / 文本 / 下拉 -->
          <div v-else>
            <label class="tc-label">{{ it.label }}</label>

            <select v-if="it.type === 'select'" v-model="form[it.key]" class="tc-input">
              <option v-for="o in it.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>

            <input
              v-else-if="it.type === 'number'"
              type="number"
              :min="it.min" :max="it.max" :step="it.step ?? 1"
              v-model.number="form[it.key]"
              class="tc-input"
            />

            <input
              v-else
              type="text"
              v-model="form[it.key]"
              class="tc-input"
              :class="it.mono ? 'font-mono text-xs' : ''"
              :placeholder="it.placeholder"
            />

            <div v-if="it.desc" class="text-xs text-fg-subtle mt-1">{{ it.desc }}</div>
          </div>
        </template>

        <!-- 依赖开关的补充字段 -->
        <template v-if="g.title === '语音播报'">
          <div v-if="form.interruptTtsHintEnabled">
            <label class="tc-label">搜索提示语</label>
            <input v-model="form.interruptTtsHintText" class="tc-input" />
          </div>
          <template v-if="form.playAnnouncementEnabled">
            <div>
              <label class="tc-label">播报模板</label>
              <input v-model="form.playAnnouncementTemplate" class="tc-input" />
              <div class="text-xs text-fg-subtle mt-1">
                占位符 <code class="tc-chip">{'{artist}'}</code>
                <code class="tc-chip">{'{song}'}</code>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="tc-label">等待方式</label>
                <select v-model="form.playAnnouncementWaitMode" class="tc-input">
                  <option value="auto">自动</option>
                  <option value="fixed">固定</option>
                </select>
              </div>
              <div>
                <label class="tc-label">延迟 (秒)</label>
                <input type="number" min="0" v-model.number="form.playAnnouncementDelay" class="tc-input" />
              </div>
            </div>
            <div>
              <label class="tc-label">生效范围</label>
              <select v-model="form.playAnnouncementScope" class="tc-input">
                <option value="voice">仅语音点歌</option>
                <option value="all">全部播放</option>
              </select>
            </div>
          </template>
        </template>

        <!-- AI 兜底：仅在开启时展开 -->
        <template v-if="g.title === '高级与 AI 兜底' && form.aiEnabled">
          <div>
            <label class="tc-label">接口地址</label>
            <input v-model="form.aiApiUrl" class="tc-input font-mono text-xs" placeholder="https://.../v1" />
          </div>
          <div>
            <label class="tc-label">密钥</label>
            <!-- 只读回显提示，真实密钥不下发到前端；留空表示保持不变 -->
            <input
              v-model="form.aiApiKey"
              type="password"
              class="tc-input font-mono text-xs"
              :placeholder="aiKeyHint ? `已配置（${aiKeyHint}），留空保持不变` : 'sk-...'"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="tc-label">模型</label>
              <input v-model="form.aiModel" class="tc-input font-mono text-xs" />
            </div>
            <div>
              <label class="tc-label">超时 (秒)</label>
              <input type="number" min="1" max="60" v-model.number="form.aiTimeout" class="tc-input" />
            </div>
          </div>
        </template>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <button class="tc-btn-primary" :disabled="saving" @click="save">
          <Icon name="check" :size="14" />
          <span>{{ saving ? '保存中…' : '保存音箱配置' }}</span>
        </button>
        <span v-if="msg" class="text-xs" :class="msg.ok ? 'text-emerald-400' : 'text-rose-400'">
          {{ msg.text }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import Icon from './Icon.vue';

/**
 * 音箱高级配置。
 *
 * 字段与 SongLoft MIoT 插件对齐，但只保留「在 ToneCore 里有对应实现或明确语义」的项；
 * 指向 SongLoft 自身服务的（server_host / external_search_* 等）不搬。
 *
 * 密钥处理：后端 status 只回传 aiApiKeySet / aiApiKeyHint（脱敏），
 * 因此这里的密钥框永远是空的 —— 留空即表示「不改动已存密钥」，
 * 后端 configure() 也会拒绝用提示串覆盖真密钥。
 */

const GROUPS = [
  {
    title: '语音指令',
    items: [
      { key: 'voiceCommandEnabled', type: 'toggle', label: '语音指令解析', desc: '关闭后只推流，不解析点歌意图' },
      { key: 'voiceMemoryEnabled', type: 'toggle', label: '语音上下文记忆', desc: '「上一首 / 下一首」依赖它' },
      { key: 'voiceMemoryMaxRecords', type: 'number', label: '记忆条数上限', min: 0, max: 1000 },
      { key: 'scheduledTasksEnabled', type: 'toggle', label: '定时任务' },
      { key: 'timezone', type: 'text', label: '时区', mono: true },
    ],
  },
  {
    title: '播放与音质',
    items: [
      { key: 'forceMp3', type: 'toggle', label: '强制转 MP3', desc: '部分老音箱不支持 FLAC' },
      { key: 'radioForceMp3', type: 'toggle', label: '电台强制 MP3' },
      { key: 'volumeNormalize', type: 'toggle', label: '音量归一化' },
      { key: 'songTransitionOffset', type: 'number', label: '切歌偏移 (秒)', min: 0, max: 60 },
    ],
  },
  {
    title: '选源策略',
    items: [
      {
        key: 'searchPriority', type: 'select', label: '选源方式',
        options: [
          { value: 'parallel', label: '并发（快，耗资源）' },
          { value: 'sequential', label: '顺序（省资源）' },
        ],
      },
      { key: 'maxSongIndex', type: 'number', label: '单条指令最多取第几首', min: 1, max: 10000 },
    ],
  },
  {
    title: '设备显示',
    items: [
      { key: 'indicatorLightEnabled', type: 'toggle', label: '指示灯' },
      { key: 'touchscreenLyricsEnabled', type: 'toggle', label: '触屏音箱显示歌词' },
    ],
  },
  {
    title: '语音播报',
    items: [
      { key: 'interruptTtsHintEnabled', type: 'toggle', label: '搜索中语音提示' },
      { key: 'playAnnouncementEnabled', type: 'toggle', label: '播放前播报' },
    ],
  },
  {
    title: '高级与 AI 兜底',
    items: [
      { key: 'smartResumeTimeout', type: 'number', label: '智能续播超时 (秒)', min: 0, max: 600 },
      { key: 'debugLogEnabled', type: 'toggle', label: '调试日志' },
      { key: 'aiEnabled', type: 'toggle', label: 'AI 意图兜底', desc: '规则解析不出结果时交给大模型' },
    ],
  },
];

/** 全部可写字段（用于初始化与提交，避免把回显用的只读字段带上去） */
const FIELDS = GROUPS.flatMap((g) => g.items.map((i) => i.key)).concat([
  'interruptTtsHintText',
  'playAnnouncementTemplate',
  'playAnnouncementWaitMode',
  'playAnnouncementDelay',
  'playAnnouncementScope',
  'aiApiUrl', 'aiApiKey', 'aiModel', 'aiTimeout',
]);

const DEFAULTS = {
  voiceCommandEnabled: true,
  voiceMemoryEnabled: true,
  voiceMemoryMaxRecords: 100,
  scheduledTasksEnabled: false,
  timezone: 'Asia/Shanghai',
  forceMp3: false,
  radioForceMp3: false,
  volumeNormalize: false,
  songTransitionOffset: 0,
  searchPriority: 'parallel',
  maxSongIndex: 10000,
  indicatorLightEnabled: true,
  touchscreenLyricsEnabled: false,
  interruptTtsHintEnabled: false,
  interruptTtsHintText: '正在搜索，请稍候',
  playAnnouncementEnabled: false,
  playAnnouncementTemplate: '即将播放{artist}的{song}',
  playAnnouncementWaitMode: 'auto',
  playAnnouncementDelay: 3,
  playAnnouncementScope: 'voice',
  smartResumeTimeout: 30,
  debugLogEnabled: false,
  aiEnabled: false,
  aiApiUrl: '',
  aiApiKey: '',
  aiModel: '',
  aiTimeout: 6,
};

const form = ref({ ...DEFAULTS });
const loading = ref(true);
const saving = ref(false);
const msg = ref(null);
/** 密钥是否已配置（后端只给脱敏提示） */
const aiKeyHint = ref('');

function pick(st) {
  const out = { ...DEFAULTS };
  for (const k of FIELDS) {
    if (st && st[k] !== undefined) out[k] = st[k];
  }
  // 密钥不在回显里，永远留空（留空 = 不改动）
  out.aiApiKey = '';
  return out;
}

async function load() {
  loading.value = true;
  try {
    const st = await api.speaker();
    form.value = pick(st);
    aiKeyHint.value = (st && st.aiApiKeyHint) || '';
  } catch (e) {
    msg.value = { ok: false, text: '读取失败：' + e };
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true; msg.value = null;
  try {
    const payload = {};
    for (const k of FIELDS) payload[k] = form.value[k];
    const st = await api.saveSpeaker(payload);
    form.value = pick(st);
    aiKeyHint.value = (st && st.aiApiKeyHint) || '';
    msg.value = { ok: true, text: '已保存' };
    setTimeout(() => { msg.value = null; }, 2000);
  } catch (e) {
    msg.value = { ok: false, text: '保存失败：' + e };
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
