<template>
  <!-- 不再用 max-w-2xl：宽屏下右半边会整片空白。改为两列栅格填满可用宽度 -->
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">设置</h1>
      <p class="text-sm text-slate-500 mt-0.5">中枢运行参数</p>
    </div>

    <div v-if="!cfg" class="tc-card p-6 text-sm text-slate-600">加载中…</div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <!-- ============ 左列 ============ -->
        <div class="space-y-5">
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
        </div><!-- /左列 -->

        <!-- ============ 右列 ============ -->
        <div class="space-y-5">
      <!-- ============ 账号管理：改账号 / 密码 / 昵称，全部落库持久化 ============ -->
      <div class="tc-card p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-2">
          <div class="text-sm font-medium text-slate-300">账号</div>
          <span class="text-[11px] text-slate-600">保存在数据库，重启不丢</span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="tc-label">登录账号</label>
            <input v-model="acct.username" class="tc-input font-mono text-xs" placeholder="登录名" />
          </div>
          <div>
            <label class="tc-label">昵称</label>
            <input v-model="acct.nickname" class="tc-input text-xs" placeholder="显示名称" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="tc-label">当前密码</label>
            <input v-model="acct.currentPassword" type="password" class="tc-input text-xs"
              placeholder="改密码时必填" autocomplete="current-password" />
          </div>
          <div>
            <label class="tc-label">新密码</label>
            <input v-model="acct.password" type="password" class="tc-input text-xs"
              placeholder="不改则留空" autocomplete="new-password" />
          </div>
        </div>

        <div v-if="acctMsg" class="text-xs" :class="acctMsg.ok ? 'text-emerald-400' : 'text-rose-400'">
          {{ acctMsg.text }}
        </div>

        <div class="flex items-center gap-2">
          <button class="tc-btn-primary text-xs" :disabled="acctBusy" @click="saveAccount">
            {{ acctBusy ? '保存中…' : '保存账号设置' }}
          </button>
          <span class="text-[11px] text-slate-600">改账号名或密码后需要重新登录</span>
        </div>

        <!-- 挂载路径：把「为什么会持久化」讲清楚 -->
        <div class="text-[11px] text-slate-600 leading-relaxed border-t border-white/[0.06] pt-2 space-y-0.5">
          <div>数据库文件：<code class="tc-badge text-[10px]">{{ cfg.dataDir || '/data' }}/tonecore.db</code></div>
          <div>持久化方式：把宿主目录挂载到容器的 <code class="tc-badge text-[10px]">/data</code>，重建容器数据不丢</div>
          <div>用户信息、播放进度、播放历史、歌单均存在该库中</div>
        </div>
      </div>

      <!-- 关于：版本、数据位置、项目信息 -->
      <div class="tc-card p-4 space-y-3">
        <div class="text-sm font-medium text-slate-300 border-b border-ink-700 pb-2">关于</div>

        <div class="flex items-center gap-3">
          <!-- 用绑定常量而非字面量 src：否则 Vite 会把它当模块去解析（public 下的资源不该被打包） -->
          <img :src="ICON" alt="ToneCore" class="w-11 h-11 rounded-xl shrink-0" />
          <div class="min-w-0">
            <div class="text-sm text-slate-200">ToneCore</div>
            <div class="text-xs text-slate-500">无头音乐中枢 · 语音点歌 / 本地曲库 / 全网音源</div>
          </div>
          <span class="tc-badge ml-auto text-[10px]">v{{ about?.version || '-' }}</span>
        </div>

        <dl class="grid grid-cols-1 gap-2 text-xs">
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-slate-600">已装音源</dt>
            <dd class="font-mono text-slate-300">{{ about?.sources ?? '-' }} 个脚本</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-slate-600">曲库</dt>
            <dd class="font-mono text-slate-300">{{ about?.library ?? '-' }} 首</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-slate-600">音乐目录</dt>
            <dd class="font-mono text-slate-400 truncate">{{ cfg.musicDir || cfg.music_dir || '-' }}</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-slate-600">数据目录</dt>
            <dd class="font-mono text-slate-400 truncate">{{ cfg.dataDir || cfg.data_dir || '-' }}</dd>
          </div>
        </dl>

        <div class="flex flex-wrap gap-2 pt-1">
          <a href="https://github.com/deltrivx/ToneCore" target="_blank" rel="noreferrer"
            class="tc-btn text-xs">项目仓库</a>
          <a href="https://github.com/deltrivx/ToneCore/releases" target="_blank" rel="noreferrer"
            class="tc-btn text-xs">更新日志</a>
          <a href="https://github.com/deltrivx/ToneCore/issues" target="_blank" rel="noreferrer"
            class="tc-btn text-xs">反馈问题</a>
        </div>

        <div class="text-[11px] text-slate-600 leading-relaxed border-t border-ink-700 pt-2">
          音源脚本遵循洛雪（LX Music）自定义源协议，由第三方维护，本项目的运行时负责加载与取链。
        </div>
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

          <!-- 监听与唤醒：对齐 SongLoft 小爱插件的可配置项 -->
          <div class="space-y-3 pt-1">
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

            <!-- 唤醒词：命中即触发点歌 -->
            <div>
              <label class="tc-label">唤醒词（回车添加，点标签删除）</label>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <span v-for="(w, i) in spkForm.wakeWords" :key="w + i"
                  class="tc-badge text-[11px] cursor-pointer hover:text-rose-400"
                  title="点击删除" @click="removeWakeWord(i)">{{ w }} ✕</span>
                <span v-if="!spkForm.wakeWords.length" class="text-xs text-slate-600">未设置，将使用默认唤醒词</span>
              </div>
              <input v-model="newWakeWord" class="tc-input font-mono text-xs"
                placeholder="例如：播放 / 我想听 / 放一首（回车添加）" @keyup.enter="addWakeWord" />
            </div>

            <!-- 生效设备：勾选后才由中枢接管 -->
            <div>
              <label class="tc-label">生效设备（不勾选=不接管）</label>
              <div v-if="!devices.length" class="text-xs text-slate-600">暂无设备，登录后自动获取</div>
              <div v-else class="space-y-1.5">
                <label v-for="dev in devices" :key="dev.id"
                  class="flex items-center gap-3 cursor-pointer rounded-lg px-2.5 py-1.5 bg-ink-800/50">
                  <input type="checkbox" :value="dev.id" v-model="spkForm.deviceIds"
                    class="w-4 h-4 accent-[color:var(--tc-neon,#4fc3f7)]" />
                  <span class="text-sm text-slate-300 truncate">{{ dev.name || dev.id }}</span>
                  <span class="text-[10px] ml-auto shrink-0"
                    :class="dev.online ? 'text-emerald-400' : 'text-slate-600'">
                    {{ dev.online ? '在线' : '离线' }}
                  </span>
                </label>
              </div>
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

        </div><!-- /右列 -->
      </div><!-- /两列栅格 -->

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
import { api, setToken } from '../composables/useApi.js';

const cfg = ref(null);
const saving = ref(false);
const saved = ref(false);
/** 「关于」区块用到的运行信息（版本 / 音源数 / 曲目数） */
const about = ref(null);

const ICON = '/icon.png';

// ---------- 账号管理 ----------
const acct = ref({ username: '', nickname: '', currentPassword: '', password: '' });
const acctBusy = ref(false);
const acctMsg = ref(null);

async function loadAccount() {
  const r = await api.v1Me();
  if (r && r.username) {
    acct.value.username = r.username;
    acct.value.nickname = r.nickname || '';
  }
}

async function saveAccount() {
  acctBusy.value = true; acctMsg.value = null;
  try {
    const payload = {
      username: acct.value.username.trim(),
      nickname: acct.value.nickname,
      currentPassword: acct.value.currentPassword,
    };
    if (acct.value.password) payload.password = acct.value.password;
    const r = await api.v1UpdateAccount(payload);
    if (r && r.ok) {
      const changed = !!acct.value.password || payload.username !== acct.value.username;
      acctMsg.value = {
        ok: true,
        text: changed ? '已保存。账号名或密码已变更，请重新登录。' : '已保存。',
      };
      acct.value.currentPassword = '';
      acct.value.password = '';
      setToken('');
      setTimeout(() => window.location.reload(), changed ? 1200 : 0);
    } else {
      acctMsg.value = { ok: false, text: (r && (r.error || r.detail)) || '保存失败' };
    }
  } catch (e) {
    acctMsg.value = { ok: false, text: '保存失败：' + e };
  } finally { acctBusy.value = false; }
}

const spk = ref(null);
const spkForm = ref({ monitorEnabled: false, pollInterval: 1, wakeWords: [], deviceIds: [] });
/** 唤醒词输入框（回车追加，避免用逗号切分容易出错） */
const newWakeWord = ref('');

function addWakeWord() {
  const w = newWakeWord.value.trim();
  if (!w) return;
  if (!spkForm.value.wakeWords.includes(w)) spkForm.value.wakeWords.push(w);
  newWakeWord.value = '';
}
function removeWakeWord(i) {
  spkForm.value.wakeWords.splice(i, 1);
}
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
  cfg.value = c;
  try { about.value = await api.health(); } catch { about.value = null; }
  await loadAccount();
  await loadSpeaker();
  await loadNowPlaying();
});
</script>
