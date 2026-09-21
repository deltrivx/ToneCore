<template>
  <div class="space-y-5 max-w-2xl">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">设置</h1>
      <p class="text-sm text-slate-500 mt-0.5">中枢运行参数</p>
    </div>

    <div v-if="!cfg" class="tc-card p-6 text-sm text-slate-600">加载中…</div>

    <template v-else>
      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">落库策略</div>

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-slate-300">点播自动落库</div>
            <div class="text-xs text-slate-600 mt-0.5">播放网络歌曲时自动保存到本地</div>
          </div>
          <input type="checkbox" v-model="cfg.autoFetch"
            class="w-10 h-5 appearance-none rounded-full bg-ink-700 checked:bg-neon-dim
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-slate-300
                   before:transition-transform checked:before:translate-x-5" />
        </label>

        <div>
          <label class="tc-label">目标音质</label>
          <select v-model="cfg.quality" class="tc-input">
            <option value="master">母带 (Master)</option>
            <option value="flac24bit">Hi-Res (24bit)</option>
            <option value="flac">无损 (FLAC/SQ)</option>
            <option value="320k">高品质 (320k)</option>
            <option value="128k">标准 (128k)</option>
          </select>
        </div>

        <div>
          <label class="tc-label">落盘路径模板</label>
          <input v-model="cfg.pathTemplate" class="tc-input font-mono text-xs" />
          <div class="text-xs text-slate-600 mt-1">
            可用变量：<code class="tc-badge text-[10px]">{'{artist}'}</code>
            <code class="tc-badge text-[10px]">{'{album}'}</code>
            <code class="tc-badge text-[10px]">{'{title}'}</code>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="tc-label">下载并发</label>
            <input type="number" min="1" max="4" v-model.number="cfg.downloadConcurrency" class="tc-input" />
          </div>
          <div>
            <label class="tc-label">任务间隔 (ms)</label>
            <input type="number" min="0" step="500" v-model.number="cfg.downloadIntervalMs" class="tc-input" />
          </div>
        </div>
      </div>

      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">平台优先级</div>
        <div class="text-xs text-slate-600">越靠前越优先（拖拽排序暂未实现，直接编辑逗号分隔）</div>
        <input :value="cfg.platforms.join(', ')" class="tc-input font-mono text-xs"
          @input="e => cfg.platforms = e.target.value.split(',').map(s => s.trim()).filter(Boolean)" />
      </div>


      <div class="tc-card p-4 space-y-4">
        <div class="flex items-center justify-between border-b border-ink-700 pb-2">
          <div class="text-sm font-medium text-slate-300">小爱音箱接入</div>
          <span class="text-[11px]" :class="spk?.enabled ? 'text-emerald-400' : 'text-slate-600'">
            {{ spk?.enabled ? '已启用' : '未启用' }}
          </span>
        </div>

        <div class="text-xs text-slate-600">
          填入小米账号凭据后即可语音点歌。凭据仅保存在本地 /data/speaker.yaml（权限 600）。
        </div>

        <div class="grid grid-cols-1 gap-3">
          <div>
            <label class="tc-label">账号 userId</label>
            <input v-model="spkForm.userId" class="tc-input font-mono text-xs" placeholder="小米账号数字 ID" />
          </div>
          <div>
            <label class="tc-label">serviceToken</label>
            <input v-model="spkForm.serviceToken" type="password" class="tc-input font-mono text-xs" placeholder="登录后获取" />
          </div>
          <div>
            <label class="tc-label">ssecurity</label>
            <input v-model="spkForm.ssecurity" type="password" class="tc-input font-mono text-xs" placeholder="签名密钥" />
          </div>
          <div>
            <label class="tc-label">唤醒词（逗号分隔）</label>
            <input :value="(spkForm.wakeWords || []).join(', ')" class="tc-input text-xs"
              @input="e => spkForm.wakeWords = e.target.value.split(',').map(s => s.trim()).filter(Boolean)" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="tc-label">轮询间隔 (秒)</label>
              <input type="number" min="1" v-model.number="spkForm.pollInterval" class="tc-input" />
            </div>
            <div class="flex items-end">
              <label class="flex items-center justify-between gap-3 cursor-pointer w-full pb-2">
                <span class="text-sm text-slate-300">监听开关</span>
                <input type="checkbox" v-model="spkForm.monitorEnabled"
                  class="w-10 h-5 appearance-none rounded-full bg-ink-700 checked:bg-neon-dim
                         relative transition-colors cursor-pointer
                         before:content-[''] before:absolute before:top-0.5 before:left-0.5
                         before:w-4 before:h-4 before:rounded-full before:bg-slate-300
                         before:transition-transform checked:before:translate-x-5" />
              </label>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="tc-btn-primary" :disabled="spkSaving" @click="saveSpeaker">
            {{ spkSaving ? '保存中…' : '保存音箱配置' }}
          </button>
          <button class="tc-btn" :disabled="spkLoading" @click="loadDevices">
            {{ spkLoading ? '拉取中…' : '拉取设备列表' }}
          </button>
          <span v-if="spkSaved" class="self-center text-sm text-emerald-400">已保存</span>
        </div>

        <div v-if="devices.length" class="space-y-2 pt-1">
          <div class="text-xs text-slate-500">共 {{ devices.length }} 台设备</div>
          <div v-for="dev in devices" :key="dev.deviceId"
            class="flex items-center justify-between gap-3 rounded-lg bg-ink-800/60 px-3 py-2">
            <div class="min-w-0">
              <div class="text-sm text-slate-300 truncate">{{ dev.name || dev.deviceId }}</div>
              <div class="text-[11px] text-slate-600 font-mono truncate">{{ dev.deviceId }}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button class="tc-btn text-xs" @click="testSay(dev.deviceId)">试播语音</button>
            </div>
          </div>
        </div>
        <div v-else-if="devicesLoaded" class="text-xs text-slate-600 pt-1">
          未获取到设备。请确认凭据正确且已保存。
        </div>

        <div v-if="spkMsg" class="text-xs" :class="spkMsg.ok ? 'text-emerald-400' : 'text-rose-400'">
          {{ spkMsg.text }}
        </div>
      </div>

      <div class="flex gap-2">
        <button class="tc-btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <span v-if="saved" class="self-center text-sm text-emerald-400">已保存</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const cfg = ref(null);
const saving = ref(false);
const saved = ref(false);

const spk = ref(null);
const spkForm = ref({
  userId: "", serviceToken: "", ssecurity: "",
  monitorEnabled: false, pollInterval: 1, wakeWords: [],
});
const spkSaving = ref(false);
const spkSaved = ref(false);
const spkLoading = ref(false);
const spkMsg = ref(null);
const devices = ref([]);
const devicesLoaded = ref(false);

async function save() {
  saving.value = true; saved.value = false;
  try {
    await api.saveConfig(cfg.value);
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } finally { saving.value = false; }
}

async function loadSpeaker() {
  try {
    const st = await api.speaker();
    spk.value = st;
    spkForm.value = {
      userId: (st && st.account) || spkForm.value.userId || "",
      serviceToken: spkForm.value.serviceToken || "",
      ssecurity: spkForm.value.ssecurity || "",
      monitorEnabled: !!(st && st.enabled),
      pollInterval: (st && st.pollInterval) || 1,
      wakeWords: (st && st.wakeWords) || spkForm.value.wakeWords || [],
      deviceIds: (st && st.devices || []).map(d => d.deviceId).filter(Boolean),
    };
    if (st && st.devices && st.devices.length) {
      devices.value = st.devices;
      devicesLoaded.value = true;
    }
  } catch (e) {
    spkMsg.value = { ok: false, text: '读取音箱状态失败：' + e };
  }
}

async function saveSpeaker() {
  spkSaving.value = true; spkSaved.value = false; spkMsg.value = null;
  try {
    const st = await api.saveSpeaker(spkForm.value);
    spk.value = st;
    spkSaved.value = true;
    spkMsg.value = { ok: true, text: spkForm.value.monitorEnabled ? '配置已保存，监听已开启' : '配置已保存' };
    setTimeout(() => { spkSaved.value = false; }, 2000);
    await loadDevices();
  } catch (e) {
    spkMsg.value = { ok: false, text: '保存失败：' + e };
  } finally { spkSaving.value = false; }
}

async function loadDevices() {
  spkLoading.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerDevices();
    devices.value = (r && r.devices) || [];
    devicesLoaded.value = true;
    if (!devices.value.length) {
      spkMsg.value = { ok: false, text: '未拉取到设备，请检查 userId / serviceToken / ssecurity' };
    } else {
      spkMsg.value = { ok: true, text: '已拉取 ' + devices.value.length + ' 台设备' };
    }
  } catch (e) {
    spkMsg.value = { ok: false, text: '拉取设备失败：' + e };
  } finally { spkLoading.value = false; }
}

async function testSay(deviceId) {
  spkMsg.value = null;
  try {
    const r = await api.speakerSay(deviceId, 'ToneCore 已接入');
    spkMsg.value = r && r.ok
      ? { ok: true, text: '已下发试播语音' }
      : { ok: false, text: '试播失败，设备可能不可达' };
  } catch (e) {
    spkMsg.value = { ok: false, text: '试播失败：' + e };
  }
}

onMounted(async () => {
  cfg.value = await api.config();
  await loadSpeaker();
});
</script>
