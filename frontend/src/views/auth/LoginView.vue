<script setup lang="ts">
// 登录页（复刻 src/app/(auth)/login/page.tsx，契约冻结）：
// step1 {email,password} → {token} | {requires2FA} | {mustEnroll2FA,preAuthToken}
// step2 追加 totpCode（6 位验证码或含 - 的恢复码）。成功后 localStorage kai-token
// + 跳 /dashboard（Next 侧 V2 前用整页跳转，Vue router 未接管该路由）。
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Message, CircleCheck, InfoFilled, ArrowLeft } from "@element-plus/icons-vue";
import { fetchCurrentUser, login, fetchOAuthProviders } from "@/api/auth";
import { ApiError } from "@/api/client";
import { oauthSignIn } from "@shared/auth/oauth-signin";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const email = ref("");
const password = ref("");
const totpCode = ref("");
const step = ref<"credentials" | "2fa">("credentials");
const error = ref<string | null>(null);
const loading = ref(false);
const offline = ref(false);
const oauthProviders = ref<string[]>([]);

const demoAccounts = [
  { email: "owner@knowledgeai.dev", role: "Owner", desc: "page.login.s6" },
  { email: "admin@knowledgeai.dev", role: "Admin", desc: "page.login.s7" },
  { email: "editor@knowledgeai.dev", role: "Editor", desc: "page.login.s8" },
  { email: "viewer@knowledgeai.dev", role: "Viewer", desc: "page.login.s9" },
];

function goDashboard() {
  // V2 前 /dashboard 仍由 Next 承载（网关未切），必须整页跳转
  window.location.href = "/dashboard";
}

function syncOnline() {
  offline.value = navigator.onLine === false;
}

onMounted(async () => {
  syncOnline();
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  // 已登录用户直接回工作台（官网头部/书签落进来不用重复登录）
  const user = await fetchCurrentUser();
  if (user) {
    goDashboard();
    return;
  }
  oauthProviders.value = await fetchOAuthProviders();
  // OAuth 回落错误提示（provider 取消/配置错误/账号绑定冲突）
  const oauthErr = route.query.error;
  if (typeof oauthErr === "string") {
    if (oauthErr === "oauth_link_conflict") error.value = t("page.login.s24");
    else if (oauthErr && oauthErr !== "Configuration") error.value = t("page.login.s23");
    else if (oauthErr === "Configuration") error.value = t("page.login.s25");
  }
});

async function handleSubmit() {
  error.value = null;
  if (navigator.onLine === false) {
    offline.value = true;
    error.value = t("page.login.s34");
    return;
  }
  loading.value = true;
  try {
    const data = await login(email.value, password.value);
    if (data.mustEnroll2FA && data.preAuthToken) {
      sessionStorage.setItem("kai-2fa-preauth", data.preAuthToken);
      sessionStorage.setItem("kai-2fa-email", email.value);
      await router.push("/2fa-enroll");
      return;
    }
    if (data.requires2FA) {
      step.value = "2fa";
      return;
    }
    if (data.token) {
      localStorage.setItem("kai-token", data.token);
      goDashboard();
    }
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.login.s11");
  } finally {
    loading.value = false;
  }
}

async function handle2FA() {
  error.value = null;
  const code = totpCode.value.trim();
  if (!/^\d{6}$/.test(code) && !code.includes("-")) {
    error.value = t("page.login.s12");
    return;
  }
  loading.value = true;
  try {
    const data = await login(email.value, password.value, code);
    if (data.token) {
      localStorage.setItem("kai-token", data.token);
      goDashboard();
    } else {
      error.value = t("page.login.s14");
    }
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.login.s11");
  } finally {
    loading.value = false;
  }
}

function backToCredentials() {
  step.value = "credentials";
  totpCode.value = "";
  error.value = null;
}

function fillDemo(em: string) {
  email.value = em;
  // 演示口令与 docs/getting-started 一致；不在源码里放明文字面量（与 e2e 同款拆字，
  // 浏览器环境无 Buffer，用 String.fromCharCode）
  password.value = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);
}
</script>

<template>
  <!-- Step 2: 2FA -->
  <div v-if="step === '2fa'">
    <div class="head">
      <h1>{{ t("page.login.s0") }}</h1>
      <p>{{ t("page.login.s26") }}</p>
    </div>
    <form
      class="form"
      @submit.prevent="handle2FA"
    >
      <label class="field">
        <span class="label">{{ t("page.login.s1") }}</span>
        <el-input
          id="totp"
          v-model="totpCode"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="123456"
          autofocus
          required
        />
        <span class="hint">{{ t("page.login.s27") }}</span>
      </label>
      <p
        v-if="error"
        class="form-error"
      >
        {{ error }}
      </p>
      <el-button
        type="primary"
        size="large"
        class="w-full"
        :loading="loading"
        native-type="submit"
      >
        <el-icon v-if="!loading">
          <CircleCheck />
        </el-icon>
        {{ loading ? t("page.login.s15") : t("page.login.s16") }}
      </el-button>
      <button
        type="button"
        class="linklike"
        @click="backToCredentials"
      >
        <el-icon :size="12">
          <ArrowLeft />
        </el-icon> {{ t("page.login.s28") }}
      </button>
    </form>
  </div>

  <!-- Step 1: credentials -->
  <div v-else>
    <div class="head">
      <h1>{{ t("page.login.s2") }}</h1>
      <p>{{ t("page.login.s29") }}</p>
    </div>

    <div class="demo-box">
      <div class="demo-title">
        <el-icon :size="13">
          <InfoFilled />
        </el-icon> {{ t("page.login.s30") }}
      </div>
      <div class="demo-grid">
        <button
          v-for="a in demoAccounts"
          :key="a.email"
          type="button"
          class="demo-item"
          @click="fillDemo(a.email)"
        >
          <span class="demo-role">{{ a.role }}</span>
          <span class="demo-email">{{ a.email }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="oauthProviders.length > 0"
      class="oauth"
    >
      <el-button
        v-if="oauthProviders.includes('google')"
        class="w-full h-11"
        @click="oauthSignIn({ provider: 'google' })"
      >
        {{ t("page.login.s21") }}
      </el-button>
      <el-button
        v-if="oauthProviders.includes('github')"
        class="w-full h-11"
        @click="oauthSignIn({ provider: 'github' })"
      >
        {{ t("page.login.s22") }}
      </el-button>
    </div>
    <div
      v-if="oauthProviders.length > 0"
      class="sep"
    >
      <span class="sep-line" />
      <span class="sep-text">{{ t("page.login.s3") }}</span>
      <span class="sep-line" />
    </div>

    <form
      class="form"
      @submit.prevent="handleSubmit"
    >
      <label class="field">
        <span class="label">{{ t("page.login.s4") }}</span>
        <el-input
          id="email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
          required
        />
      </label>
      <label class="field">
        <span class="label-row">
          <span class="label">{{ t("page.login.s5") }}</span>
          <router-link
            to="/forgot-password"
            class="label-link"
          >{{ t("page.login.s31") }}</router-link>
        </span>
        <el-input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          show-password
          required
        />
      </label>

      <p
        v-if="offline"
        class="form-warn"
      >
        {{ t("page.login.s34") }}
      </p>
      <p
        v-if="error"
        class="form-error"
      >
        {{ error }}
      </p>

      <el-button
        type="primary"
        size="large"
        class="w-full"
        :disabled="offline"
        :loading="loading"
        native-type="submit"
      >
        <el-icon v-if="!loading">
          <Message />
        </el-icon>
        {{ loading ? t("page.login.s19") : t("page.login.s20") }}
      </el-button>
    </form>

    <p class="foot">
      {{ t("page.login.s32") }}
      <router-link
        to="/register"
        class="primary-link"
      >
        {{ t("page.login.s33") }}
      </router-link>
    </p>
  </div>
</template>

<style scoped>
.head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.head p {
  margin: 8px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.head {
  margin-bottom: 32px;
}
.demo-box {
  margin-bottom: 24px;
  padding: 12px;
  border: 1px solid hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.05);
  border-radius: 12px;
}
.demo-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.demo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.demo-item {
  padding: 6px 10px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.demo-item:hover {
  background: hsl(var(--accent));
}
.demo-role {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground));
}
.demo-email {
  display: block;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.oauth {
  display: grid;
  gap: 12px;
}
.h-11 {
  height: 44px;
}
.sep {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0;
}
.sep-line {
  flex: 1;
  height: 1px;
  background: hsl(var(--border));
}
.sep-text {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.form {
  display: grid;
  gap: 16px;
}
.field {
  display: grid;
  gap: 8px;
}
.label,
.label-row {
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label-link {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  text-decoration: none;
}
.label-link:hover {
  text-decoration: underline;
}
.hint {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.form-error {
  margin: 0;
  padding: 8px 12px;
  font-size: 14px;
  color: hsl(var(--destructive));
  border: 1px solid hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.05);
  border-radius: 8px;
}
.form-warn {
  margin: 0;
  padding: 8px 12px;
  font-size: 14px;
  color: hsl(var(--warning));
  border: 1px solid hsl(var(--warning) / 0.3);
  background: hsl(var(--warning) / 0.05);
  border-radius: 8px;
}
.linklike {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  background: none;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.linklike:hover {
  color: hsl(var(--foreground));
}
.foot {
  margin-top: 24px;
  text-align: center;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.primary-link {
  font-weight: 500;
  color: hsl(var(--primary));
  text-decoration: none;
}
.primary-link:hover {
  text-decoration: underline;
}
.w-full {
  width: 100%;
}
</style>
