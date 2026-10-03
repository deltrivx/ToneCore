<template>
  <!-- 不再用 max-w-2xl：宽屏下右半边会整片空白。改为两列栅格填满可用宽度 -->
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-fg">设置</h1>
      <p class="text-sm text-fg-subtle mt-0.5">中枢运行参数</p>
    </div>

    <div v-if="!cfg" class="tc-card p-6 text-sm text-fg-subtle">加载中…</div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <!-- ============ 左列 ============ -->
        <div class="space-y-5">
      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-fg-muted border-b border-line pb-2">落库策略</div>

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-fg-muted">点播自动落库</div>
            <div class="text-xs text-fg-subtle mt-0.5">播放网络歌曲时自动保存到本地</div>
          </div>
          <input type="checkbox" v-model="cfg.autoFetch"
            class="w-10 h-5 appearance-none rounded-full bg-surface-overlay checked:bg-accent
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-fg
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
          <div class="text-xs text-fg-subtle mt-1">
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
            <div class="text-sm text-fg-muted">嵌入标签与封面</div>
            <div class="text-xs text-fg-subtle mt-0.5">落库后自动写入 ID3 / Vorbis 标签与专辑封面</div>
          </div>
          <input type="checkbox" v-model="cfg.embedMetadata"
            class="w-10 h-5 appearance-none rounded-full bg-surface-overlay checked:bg-accent
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-fg
                   before:transition-transform checked:before:translate-x-5" />
        </label>

        <label class="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div class="text-sm text-fg-muted">写入歌词</div>
            <div class="text-xs text-fg-subtle mt-0.5">同时写入标签与同名 .lrc 文件</div>
          </div>
          <input type="checkbox" v-model="cfg.writeLyrics"
            class="w-10 h-5 appearance-none rounded-full bg-surface-overlay checked:bg-accent
                   relative transition-colors cursor-pointer
                   before:content-[''] before:absolute before:top-0.5 before:left-0.5
                   before:w-4 before:h-4 before:rounded-full before:bg-fg
                   before:transition-transform checked:before:translate-x-5" />
        </label>
      </div>

      <div class="tc-card p-4 space-y-4">
        <div class="text-sm font-medium text-fg-muted border-b border-line pb-2">平台优先级</div>
        <div class="text-xs text-fg-subtle">越靠前越优先（拖拽排序暂未实现，直接编辑逗号分隔）</div>
        <input :value="cfg.platforms.join(', ')" class="tc-input font-mono text-xs"
          @input="e => cfg.platforms = e.target.value.split(',').map(s => s.trim()).filter(Boolean)" />
      </div>
        </div><!-- /左列 -->

        <!-- ============ 右列 ============ -->
        <div class="space-y-5">
      <!-- ============ 账号管理：改账号 / 密码 / 昵称，全部落库持久化 ============ -->
      <div class="tc-card p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-line pb-2">
          <div class="text-sm font-medium text-fg-muted">账号</div>
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
          <span class="text-[11px] text-fg-subtle">改账号名或密码后需要重新登录</span>
        </div>

      </div>

      <!-- ============ 网易云账号（扫码登录）============
           登录后：每日推荐变为个性化、可取个人歌单、有机会拿到更高音质。
           ⚠️ cookie 只存服务端，界面与接口都不暴露凭据原文。 -->
      <div class="tc-card p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-line pb-2">
          <div class="text-sm font-medium text-fg-muted">网易云账号</div>
          <span v-if="ne.loggedIn" class="tc-badge text-[10px]">已登录</span>
          <span v-else class="text-[11px] text-fg-subtle">未登录</span>
        </div>

        <div v-if="ne.loggedIn" class="space-y-2">
          <div class="text-sm text-fg">
            {{ ne.nickname || ('用户 ' + ne.userId) }}
          </div>
          <div class="text-[11px] text-fg-subtle leading-relaxed">
            已启用：个性化每日推荐、个人歌单读取、更高音质取链。
          </div>
          <button class="tc-btn text-xs" :disabled="neBusy" @click="neLogout">退出登录</button>
        </div>

        <div v-else-if="neQr.url" class="space-y-2">
          <div class="flex gap-3 items-start">
            <img :src="neQr.img" alt="网易云登录二维码"
              class="w-32 h-32 rounded border border-line bg-white" />
            <div class="text-[11px] text-fg-subtle leading-relaxed min-w-0">
              <div class="text-fg mb-1">用网易云 App 扫码</div>
              <div v-if="neQr.code === 801">等待扫码…</div>
              <div v-else-if="neQr.code === 802" class="text-emerald-400">已扫码，请在手机上确认</div>
              <div v-else-if="neQr.code === 800">二维码已过期，正在刷新…</div>
              <div v-else>正在生成…</div>
              <button class="tc-btn text-[11px] mt-2" @click="stopQr">取消</button>
            </div>
          </div>
        </div>

        <div v-else class="space-y-2">
          <div class="text-[11px] text-fg-subtle leading-relaxed">
            未登录时：每日推荐是全网通用版（非个性化），个人歌单不可用，
            无损会被降级为 320k。登录后即可解锁这些能力。
          </div>
          <button class="tc-btn-primary text-xs" :disabled="neBusy" @click="startQr">
            {{ neBusy ? '处理中…' : '扫码登录网易云' }}
          </button>
        </div>

        <div v-if="neMsg" class="text-xs" :class="neMsg.ok ? 'text-emerald-400' : 'text-rose-400'">
          {{ neMsg.text }}
        </div>
      </div>

      <div class="tc-card p-4 space-y-3">
        <div class="text-sm font-medium text-fg-muted border-b border-line pb-2">关于</div>

        <div class="flex items-center gap-3">
          <!-- 用绑定常量而非字面量 src：否则 Vite 会把它当模块去解析（public 下的资源不该被打包） -->
          <img :src="ICON" alt="ToneCore" class="w-11 h-11 rounded-lg shrink-0" />
          <div class="min-w-0">
            <div class="text-sm text-fg">ToneCore</div>
            <div class="text-xs text-fg-subtle">无头音乐中枢 · 语音点歌 / 本地曲库 / 全网音源</div>
          </div>
          <span class="tc-badge ml-auto text-[10px]">v{{ about?.version || '-' }}</span>
        </div>

        <dl class="grid grid-cols-1 gap-2 text-xs">
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-fg-subtle">已装音源</dt>
            <dd class="font-mono text-fg-muted">{{ about?.sources ?? '-' }} 个脚本</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-fg-subtle">曲库</dt>
            <dd class="font-mono text-fg-muted">{{ about?.library ?? '-' }} 首</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-fg-subtle">音乐目录</dt>
            <dd class="font-mono text-fg-muted truncate">{{ cfg.musicDir || cfg.music_dir || '-' }}</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="w-20 shrink-0 text-fg-subtle">数据目录</dt>
            <dd class="font-mono text-fg-muted truncate">{{ cfg.dataDir || cfg.data_dir || '-' }}</dd>
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

        <div class="text-[11px] text-fg-subtle leading-relaxed border-t border-line pt-2">
          音源脚本遵循洛雪（LX Music）自定义源协议，由第三方维护，本项目的运行时负责加载与取链。
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
import Icon from '../components/Icon.vue';

const cfg = ref(null);
const saving = ref(false);
const saved = ref(false);
/** 「关于」区块用到的运行信息（版本 / 音源数 / 曲目数） */
const about = ref(null);

const ICON = '/icon.png';

// ---------- 网易云扫码登录 ----------
const ne = ref({ loggedIn: false, nickname: '', userId: null });
const neBusy = ref(false);
const neMsg = ref(null);
/** 二维码会话：url=二维码内容、img=二维码图、code=扫码状态 */
const neQr = ref({ key: '', url: '', img: '', code: 0 });
let neTimer = null;

function stopQr() {
  if (neTimer) { clearInterval(neTimer); neTimer = null; }
  neQr.value = { key: '', url: '', img: '', code: 0 };
}

async function loadNeStatus() {
  const r = await api.neteaseStatus();
  if (r && r.ok) ne.value = { loggedIn: !!r.loggedIn, nickname: r.nickname || '', userId: r.userId || null };
}

/**
 * 开始扫码登录。
 *
 * 轮询语义（与服务端一致）：800 过期 / 801 待扫码 / 802 待确认 / 803 成功。
 * 二维码过期（800）自动重新拉一张，不需要用户手动再点一次。
 */
async function startQr() {
  neBusy.value = true; neMsg.value = null;
  try {
    const r = await api.neteaseQr();
    if (!r || !r.ok) { neMsg.value = { ok: false, text: (r && r.error) || '取二维码失败' }; return; }
    neQr.value = { key: r.unikey, url: r.url, img: r.dataUrl || '', code: 801 };

    if (neTimer) clearInterval(neTimer);
    neTimer = setInterval(async () => {
      const c = await api.neteaseQrCheck(neQr.value.key);
      if (!c || !c.ok) return;
      neQr.value.code = c.code;
      if (c.code === 803) {
        stopQr();
        await loadNeStatus();
        neMsg.value = { ok: true, text: '网易云登录成功' };
      } else if (c.code === 800) {
        // 过期：重新拉一张，继续等
        const r2 = await api.neteaseQr();
        if (r2 && r2.ok) neQr.value = { key: r2.unikey, url: r2.url, img: r2.dataUrl || '', code: 801 };
      }
    }, 3000);
  } catch (e) {
    neMsg.value = { ok: false, text: '取二维码失败：' + e };
  } finally { neBusy.value = false; }
}

async function neLogout() {
  neBusy.value = true; neMsg.value = null;
  try {
    await api.neteaseLogout();
    await loadNeStatus();
    neMsg.value = { ok: true, text: '已退出网易云登录' };
  } catch (e) {
    neMsg.value = { ok: false, text: '退出失败：' + e };
  } finally { neBusy.value = false; }
}

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

async function save() {
  saving.value = true; saved.value = false;
  try {
    await api.saveConfig(cfg.value);
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } finally { saving.value = false; }
}


onMounted(async () => {
  const c = await api.config();
  cfg.value = c;
  try { about.value = await api.health(); } catch { about.value = null; }
  await loadAccount();
  try { await loadNeStatus(); } catch { /* 网易云状态失败不影响设置页 */ }
});

// 离开页面时务必停掉轮询，否则定时器泄漏、后台一直打接口
import { onBeforeUnmount } from 'vue';
onBeforeUnmount(() => { if (neTimer) clearInterval(neTimer); });
</script>
