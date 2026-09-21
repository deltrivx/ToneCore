<template>
  <div class="space-y-5 max-w-2xl">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">设置</h1>
      <p class="text-sm text-slate-500 mt-0.5">中枢运行参数</p>
    </div>

    <div v-if="!cfg" class="tc-card p-6 text-sm text-slate-600">加载中…</div>

    <template v-else>
      <!-- 被容器环境变量锁定的字段：改这里不会生效，必须改模板 -->
      <div v-if="lockedFields.length" class="tc-card p-3 text-xs text-amber-400/90 leading-relaxed">
        以下配置由容器环境变量锁定，在此修改不会生效，请改容器模板 / compose 后重建：
        <span class="font-mono text-amber-300">{{ lockedFields.join('、') }}</span>
      </div>
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

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-slate-300">嵌入标签与封面</div>
            <div class="text-xs text-slate-600 mt-0.5">落库后自动写入 ID3 / Vorbis 标签与专辑封面</div>
          </div>
          <input type="checkbox" v-model="cfg.embedMetadata"
            class="w-10 h-5 appearance-none rounded-full bg-ink-700 checked:bg-neon-dim
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-slate-300
                   before:transition-transform checked:before:translate-x-5" />
        </label>

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-slate-300">写入歌词</div>
            <div class="text-xs text-slate-600 mt-0.5">同时写入标签与同名 .lrc 文件</div>
          </div>
          <input type="checkbox" v-model="cfg.writeLyrics"
            class="w-10 h-5 appearance-none rounded-full bg-ink-700 checked:bg-neon-dim
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-slate-300
                   before:transition-transform checked:before:translate-x-5" />
        </label>
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
          <div class="flex items-center gap-2">
            <span class="text-[11px]" :class="spk?.enabled ? 'text-emerald-400' : 'text-slate-600'">
              {{ spk?.enabled ? '监听中' : '未监听' }}
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-full"
              :class="spk?.loggedIn ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-600/20 text-slate-500'">
              {{ spk?.loggedIn ? '已登录' : '未登录' }}
            </span>
          </div>
        </div>

        <div class="text-xs text-slate-600">
          填写小米账号与密码即可登录，登录后设备与凭据自动获取（凭据保存在本地 /data/speaker.yaml，权限 600）。
        </div>

        <!-- 未登录：账号密码表单 -->
        <template v-if="!spk?.loggedIn">
          <div class="grid grid-cols-1 gap-3">
            <div>
              <label class="tc-label">小米账号</label>
              <input v-model="loginForm.username" class="tc-input font-mono text-xs"
                placeholder="手机号 / 邮箱 / 小米 ID" @keyup.enter="doLogin" />
            </div>
            <div>
              <label class="tc-label">密码</label>
              <input v-model="loginForm.password" type="password" class="tc-input font-mono text-xs"
                placeholder="小米账号密码" @keyup.enter="doLogin" />
            </div>
          </div>

          <!-- 需要验证码 -->
          <div v-if="needVerify" class="space-y-3 rounded-lg bg-ink-800/60 p-3">
            <div class="text-xs text-amber-400">需要短信 / 邮箱验证码</div>
            <div>
              <label class="tc-label">验证码</label>
              <input v-model="loginForm.code" class="tc-input font-mono text-xs"
                placeholder="请输入收到的验证码" @keyup.enter="doVerify" />
            </div>
            <div class="flex gap-2">
              <button class="tc-btn-primary text-xs" :disabled="busy" @click="doVerify">提交验证码</button>
              <a v-if="verifyUrl" :href="verifyUrl" target="_blank" class="tc-btn text-xs">打开验证页</a>
            </div>
          </div>

          <div class="flex gap-2">
            <button class="tc-btn-primary" :disabled="busy" @click="doLogin">
              {{ busy ? '登录中…' : '登录' }}
            </button>
          </div>
        </template>

        <!-- 已登录：账号信息 + 设备列表 -->
        <template v-else>
          <div class="flex items-center justify-between gap-3 rounded-lg bg-ink-800/60 px-3 py-2">
            <div class="min-w-0">
              <div class="text-sm text-slate-300">{{ spk?.account || '已登录' }}</div>
              <div class="text-[11px] text-slate-600 font-mono truncate">
                userId {{ spk?.userId }} · {{ devices.length }} 台设备
              </div>
            </div>
            <button class="tc-btn text-xs shrink-0" :disabled="busy" @click="doLogout">退出登录</button>
          </div>

          <div v-if="devices.length" class="space-y-2">
            <div v-for="dev in devices" :key="dev.id"
              class="rounded-lg bg-ink-800/60 px-3 py-2 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-slate-300 truncate">
                    {{ dev.name || dev.id }}
                    <span v-if="dev.online" class="text-[10px] text-emerald-400 ml-1">在线</span>
                    <span v-else class="text-[10px] text-slate-600 ml-1">离线</span>
                  </div>
                  <div class="text-[11px] text-slate-600 font-mono truncate">{{ dev.id }}</div>
                </div>
                <button class="tc-btn text-xs shrink-0" :disabled="busy" @click="testSay(dev.id)">试播语音</button>
              </div>
              <!-- 播放控制：与语音指令走同一套底层能力 -->
              <div class="flex items-center gap-1.5 flex-wrap">
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="ctl(dev.id, 'prev')">上一首</button>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="ctl(dev.id, 'pause')">暂停</button>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="ctl(dev.id, 'play')">继续</button>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="ctl(dev.id, 'next')">下一首</button>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="ctl(dev.id, 'stop')">停止</button>
                <span class="text-[10px] text-slate-600 ml-1">音量</span>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="vol(dev.id, -15)">－</button>
                <button class="tc-btn text-xs py-1 px-2" :disabled="busy" @click="vol(dev.id, 15)">＋</button>
              </div>
              <div v-if="nowPlaying[dev.id]" class="text-[11px] text-slate-500 truncate">
                正在播放：{{ nowPlaying[dev.id].artist }} — {{ nowPlaying[dev.id].title }}
                <span class="text-slate-700 font-mono">
                  （队列 {{ nowPlaying[dev.id].queueIndex + 1 }}/{{ nowPlaying[dev.id].queueSize }}）
                </span>
              </div>
            </div>
          </div>
          <div v-else class="text-xs text-slate-600">
            暂无设备。若音箱未上线，请先在米家 App 确认设备在线。
          </div>

          <div class="grid grid-cols-2 gap-3 pt-1">
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
          <button class="tc-btn-primary" :disabled="busy" @click="saveSpeakerCfg">
            {{ busy ? '保存中…' : '保存监听设置' }}
          </button>
        </template>

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
/** 被环境变量锁定的字段名（由后端 /api/config 下发） */
const lockedFields = ref([]);

const spk = ref(null);
const spkForm = ref({ monitorEnabled: false, pollInterval: 1, wakeWords: [] });
const loginForm = ref({ username: '', password: '', code: '' });
const needVerify = ref(false);
const verifyUrl = ref('');
const verifySign = ref('');
const busy = ref(false);
const spkMsg = ref(null);
const devices = ref([]);
const nowPlaying = ref({});

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
      monitorEnabled: !!(st && st.enabled),
      pollInterval: (st && st.pollInterval) || 1,
      wakeWords: (st && st.wakeWords) || [],
      deviceIds: ((st && st.devices) || []).map(d => d.id).filter(Boolean),
    };
    devices.value = (st && st.devices) || [];
    if (st && st.account && !loginForm.value.username) loginForm.value.username = st.account;
  } catch (e) {
    spkMsg.value = { ok: false, text: '读取音箱状态失败：' + e };
  }
}

async function doLogin() {
  busy.value = true; spkMsg.value = null; needVerify.value = false;
  try {
    const r = await api.speakerLogin(loginForm.value.username.trim(), loginForm.value.password);
    if (r && r.ok) {
      if (r.status) { spk.value = r.status; devices.value = r.status.devices || []; }
      spkMsg.value = { ok: true, text: '登录成功' };
      await loadSpeaker();
    } else if (r && r.needVerify) {
      needVerify.value = true;
      verifyUrl.value = r.notificationUrl || '';
      verifySign.value = r.sign || '';
      spkMsg.value = { ok: false, text: '需要验证码，已发送至你的手机 / 邮箱' };
    } else {
      spkMsg.value = { ok: false, text: '登录失败：' + ((r && r.error) || '未知错误') };
    }
  } catch (e) {
    spkMsg.value = { ok: false, text: '登录失败：' + e };
  } finally { busy.value = false; }
}

async function doVerify() {
  busy.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerVerify({
      username: loginForm.value.username.trim(),
      password: loginForm.value.password,
      code: loginForm.value.code.trim(),
      sign: verifySign.value,
    });
    if (r && r.ok) {
      needVerify.value = false;
      if (r.status) { spk.value = r.status; devices.value = r.status.devices || []; }
      spkMsg.value = { ok: true, text: '验证成功，已登录' };
      await loadSpeaker();
    } else {
      spkMsg.value = { ok: false, text: '验证失败：' + ((r && r.error) || '验证码错误') };
    }
  } catch (e) {
    spkMsg.value = { ok: false, text: '验证失败：' + e };
  } finally { busy.value = false; }
}

async function doLogout() {
  busy.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerLogout();
    spk.value = (r && r.status) || null;
    devices.value = [];
    loginForm.value = { username: '', password: '', code: '' };
    needVerify.value = false;
    spkMsg.value = { ok: true, text: '已退出登录' };
  } catch (e) {
    spkMsg.value = { ok: false, text: '退出失败：' + e };
  } finally { busy.value = false; }
}

async function saveSpeakerCfg() {
  busy.value = true; spkMsg.value = null;
  try {
    const st = await api.saveSpeaker(spkForm.value);
    spk.value = st;
    spkMsg.value = { ok: true, text: spkForm.value.monitorEnabled ? '已保存，监听已开启' : '已保存，监听已关闭' };
  } catch (e) {
    spkMsg.value = { ok: false, text: '保存失败：' + e };
  } finally { busy.value = false; }
}

async function testSay(deviceId) {
  busy.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerSay(deviceId, 'ToneCore 已接入');
    spkMsg.value = r && r.ok
      ? { ok: true, text: '已下发试播语音' }
      : { ok: false, text: '试播失败，设备可能不可达' };
  } catch (e) {
    spkMsg.value = { ok: false, text: '试播失败：' + e };
  } finally { busy.value = false; }
}

/** 下发播放控制指令 */
async function ctl(deviceId, action) {
  busy.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerControl(deviceId, action);
    spkMsg.value = r && r.ok
      ? { ok: true, text: `已下发「${action}」指令` }
      : { ok: false, text: `指令未送达：${(r && r.error) || '设备可能离线'}` };
    await loadNowPlaying();
  } catch (e) {
    spkMsg.value = { ok: false, text: '指令失败：' + e };
  } finally { busy.value = false; }
}

/** 相对调节音量 */
async function vol(deviceId, delta) {
  busy.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerVolume({ deviceId, delta });
    spkMsg.value = r && r.ok
      ? { ok: true, text: `音量已${delta > 0 ? '调高' : '调低'}` }
      : { ok: false, text: '音量调节未送达' };
  } catch (e) {
    spkMsg.value = { ok: false, text: '音量调节失败：' + e };
  } finally { busy.value = false; }
}

/** 拉取各设备当前播放上下文 */
async function loadNowPlaying() {
  try {
    const r = await api.speakerNow();
    nowPlaying.value = (r && r.sessions) || {};
  } catch { /* 展示性信息，失败不影响主流程 */ }
}

onMounted(async () => {
  const c = await api.config();
  lockedFields.value = (c && c._lockedByEnv) || [];
  cfg.value = c;
  await loadSpeaker();
  await loadNowPlaying();
});
</script>
