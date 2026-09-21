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
            <div class="text-xs text-amber-400">
              需要短信 / 邮箱验证码
              <span class="text-slate-500">（验证码由服务端自动发送，在此直接填写即可）</span>
            </div>
            <div>
              <label class="tc-label">验证码</label>
              <input v-model="loginForm.code" class="tc-input font-mono text-xs"
                placeholder="请输入收到的验证码" @keyup.enter="doVerify" />
            </div>
            <div class="flex gap-2">
              <button class="tc-btn-primary text-xs" :disabled="busy" @click="doVerify">提交验证码</button>
              <button class="tc-btn text-xs" :disabled="sending" @click="doSendCode">
                {{ sending ? '发送中…' : '重新发送验证码' }}
              </button>
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
              class="flex items-center justify-between gap-3 rounded-lg bg-ink-800/60 px-3 py-2">
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

const spk = ref(null);
const spkForm = ref({ monitorEnabled: false, pollInterval: 1, wakeWords: [] });
const loginForm = ref({ username: '', password: '', code: '' });
const needVerify = ref(false);
const verifySign = ref('');
const verifyUrl = ref('');
const sending = ref(false);
const busy = ref(false);
const spkMsg = ref(null);
const devices = ref([]);

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
      verifySign.value = r.sign || '';
      verifyUrl.value = r.notificationUrl || '';
      spkMsg.value = r.ticketSent
        ? { ok: true, text: '验证码已发送至你的手机 / 邮箱，请查收后填入下方' }
        : { ok: false, text: '验证码发送失败：' + ((r.ticketError) || '请点「重新发送」重试') };
    } else {
      spkMsg.value = { ok: false, text: '登录失败：' + ((r && r.error) || '未知错误') };
    }
  } catch (e) {
    spkMsg.value = { ok: false, text: '登录失败：' + e };
  } finally { busy.value = false; }
}

async function doSendCode() {
  if (!verifyUrl.value) {
    spkMsg.value = { ok: false, text: '请先点「登录」获取验证会话' };
    return;
  }
  sending.value = true; spkMsg.value = null;
  try {
    const r = await api.speakerSendCode(verifyUrl.value);
    spkMsg.value = r && r.ok
      ? { ok: true, text: '验证码已重新发送，请查收' }
      : { ok: false, text: '发送失败：' + ((r && r.error) || '请稍后重试') };
  } catch (e) {
    spkMsg.value = { ok: false, text: '发送失败：' + e };
  } finally { sending.value = false; }
}

async function doVerify() {
  busy.value = true; spkMsg.value = null;
  try {
    const code = loginForm.value.code.trim();
    if (!code) {
      spkMsg.value = { ok: false, text: '请先填写收到的验证码' };
      return;
    }
    if (!verifySign.value) {
      spkMsg.value = { ok: false, text: '登录会话已过期，请重新点「登录」获取验证码' };
      return;
    }
    const r = await api.speakerVerify({
      username: loginForm.value.username.trim(),
      password: loginForm.value.password,
      code,
      sign: verifySign.value,
    });
    if (r && r.ok) {
      needVerify.value = false;
    verifyUrl.value = '';
    verifySign.value = '';
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

onMounted(async () => {
  cfg.value = await api.config();
  await loadSpeaker();
});
</script>
