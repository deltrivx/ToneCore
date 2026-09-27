<template>
  <div class="min-h-screen flex items-center justify-center px-4 bg-surface">
    <div class="w-full max-w-sm">
      <!-- 品牌：居中、克制，不做发光特效 -->
      <div class="flex flex-col items-center gap-3 mb-7">
        <img :src="ICON" alt="ToneCore" class="w-14 h-14 rounded-xl" />
        <div class="text-lg font-semibold text-fg">ToneCore</div>
        <div class="text-xs text-fg-subtle">登录以进入中枢控制台</div>
      </div>

      <div class="tc-card p-5 space-y-4">
        <div>
          <label class="tc-label">账号</label>
          <input
            v-model="form.username"
            class="tc-input"
            placeholder="用户名"
            autocomplete="username"
            @keyup.enter="submit"
          />
        </div>
        <div>
          <label class="tc-label">密码</label>
          <input
            v-model="form.password"
            type="password"
            class="tc-input"
            placeholder="密码"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </div>

        <div v-if="err" class="tc-alert tc-alert-err">
          <Icon name="alert" :size="16" class="mt-0.5" />
          <span>{{ err }}</span>
        </div>

        <button class="tc-btn-primary w-full" :disabled="busy" @click="submit">
          {{ busy ? '登录中…' : '登录' }}
        </button>

        <div class="text-[11px] text-fg-subtle leading-relaxed border-t border-line pt-3">
          默认账号 <code class="tc-chip">admin</code>
          / 密码 <code class="tc-chip">password</code>。
          可用环境变量 <code class="tc-chip">TONECORE_ADMIN_USER</code>、
          <code class="tc-chip">TONECORE_ADMIN_PASSWORD</code> 覆盖。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api, setToken } from '../composables/useApi.js';
import Icon from '../components/Icon.vue';

const emit = defineEmits(['ok']);
const ICON = '/icon.png';

const form = ref({ username: '', password: '' });
const busy = ref(false);
const err = ref('');

async function submit() {
  if (!form.value.username.trim() || !form.value.password) {
    err.value = '请输入账号与密码';
    return;
  }
  busy.value = true; err.value = '';
  try {
    const r = await api.v1Login(form.value.username.trim(), form.value.password);
    if (r && r.access_token) {
      setToken(r.access_token);
      emit('ok');
    } else {
      err.value = (r && (r.error || r.detail)) || '登录失败';
    }
  } catch (e) {
    err.value = '登录失败：' + e;
  } finally { busy.value = false; }
}
</script>
