<script setup lang="ts">
// 强制 2FA 绑定：登录响应 mustEnroll2FA 时由登录页写入 sessionStorage 后跳入。
// action=enroll 拿 secret/qrCodeDataUrl/backupCodes → action=verify 校验 6 位码
// → 服务端建会话返回 token。契约冻结（POST /api/auth/2fa-enroll）。
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { CircleCheck, CopyDocument, Check, WarningFilled } from "@element-plus/icons-vue";
import { enroll2fa, type EnrollSetup } from "@/api/auth";
import { ApiError } from "@/api/client";

const { t } = useTranslation();
const router = useRouter();

const preAuthToken = typeof window !== "undefined" ? sessionStorage.getItem("kai-2fa-preauth") : null;
const email = typeof window !== "undefined" ? sessionStorage.getItem("kai-2fa-email") || "" : "";

const enrollData = ref<EnrollSetup | null>(null);
const code = ref("");
const error = ref<string | null>(null);
// 绑定挂载即自动开始，初始 loading
const loading = ref(true);
const phase = ref<"setup" | "verify">("setup");
const copied = ref(false);

onMounted(async () => {
  if (!preAuthToken) {
    await router.replace("/login");
    return;
  }
  try {
    const data = await enroll2fa(preAuthToken, "enroll");
    if (data && data.secret) {
      enrollData.value = { secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl, backupCodes: data.backupCodes };
    } else {
      error.value = t("page.2fa-enroll.s3");
    }
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.2fa-enroll.s4");
  } finally {
    loading.value = false;
  }
});

async function handleVerify() {
  error.value = null;
  if (!/^\d{6}$/.test(code.value.trim()) || !preAuthToken) {
    error.value = t("page.2fa-enroll.s5");
    return;
  }
  loading.value = true;
  try {
    const data = await enroll2fa(preAuthToken, "verify", code.value.trim());
    if (data?.token) {
      sessionStorage.removeItem("kai-2fa-preauth");
      sessionStorage.removeItem("kai-2fa-email");
      localStorage.setItem("kai-token", data.token);
      window.location.href = "/dashboard";
    }
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.2fa-enroll.s4");
  } finally {
    loading.value = false;
  }
}

async function copyCodes() {
  if (!enrollData.value) return;
  await navigator.clipboard?.writeText(enrollData.value.backupCodes.join("\n"));
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

function backToSetup() {
  phase.value = "setup";
  code.value = "";
  error.value = null;
}
</script>

<template>
  <div>
    <div class="head">
      <h1>{{ t("page.2fa-enroll.s0") }}</h1>
      <p>
        {{ t("page.2fa-enroll.s12") }}
        <span
          v-if="email"
          class="email-line"
        >{{ t("page.2fa-enroll.s13", { email }) }}</span>
      </p>
    </div>

    <p
      v-if="error"
      class="form-error"
    >
      <el-icon><WarningFilled /></el-icon> {{ error }}
    </p>

    <!-- setup: 展示 QR + 密钥 + 恢复码 -->
    <div
      v-if="phase === 'setup'"
      class="form"
    >
      <div
        v-if="loading && !enrollData"
        class="loading"
      >
        {{ t("page.2fa-enroll.s14") }}
      </div>
      <template v-else-if="enrollData">
        <div class="qr-box">
          <p class="qr-hint">
            {{ t("page.2fa-enroll.s15") }}
          </p>
          <img
            :src="enrollData.qrCodeDataUrl"
            :alt="t('page.2fa-enroll.s7')"
            width="200"
            height="200"
            class="qr-img"
          >
          <p class="qr-hint">
            {{ t("page.2fa-enroll.s16") }}
          </p>
          <code class="secret">{{ enrollData.secret }}</code>
        </div>

        <div class="codes-box">
          <div class="codes-head">
            <p class="codes-title">
              {{ t("page.2fa-enroll.s1") }}
            </p>
            <el-button
              size="small"
              text
              @click="copyCodes"
            >
              <el-icon v-if="copied">
                <Check />
              </el-icon>
              <el-icon v-else>
                <CopyDocument />
              </el-icon>
              {{ copied ? t("page.2fa-enroll.s8") : t("page.2fa-enroll.s9") }}
            </el-button>
          </div>
          <div class="codes-grid">
            <code
              v-for="c in enrollData.backupCodes"
              :key="c"
              class="code-item"
            >{{ c }}</code>
          </div>
        </div>

        <el-button
          type="primary"
          size="large"
          class="w-full"
          @click="phase = 'verify'"
        >
          <el-icon><CircleCheck /></el-icon> {{ t("page.2fa-enroll.s17") }}
        </el-button>
      </template>
    </div>

    <!-- verify: 输入 6 位码 -->
    <form
      v-if="phase === 'verify'"
      class="form"
      @submit.prevent="handleVerify"
    >
      <label class="field">
        <span class="label">{{ t("page.2fa-enroll.s2") }}</span>
        <el-input
          id="code"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="123456"
          autofocus
          required
        />
      </label>
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
        {{ loading ? t("page.2fa-enroll.s10") : t("page.2fa-enroll.s11") }}
      </el-button>
      <button
        type="button"
        class="linklike"
        @click="backToSetup"
      >
        {{ t("page.2fa-enroll.s18") }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 24px;
}
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
.email-line {
  display: block;
}
.form {
  display: grid;
  gap: 16px;
}
.field {
  display: grid;
  gap: 8px;
}
.label {
  font-size: 14px;
  font-weight: 500;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
}
.qr-hint {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-align: center;
}
.qr-img {
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: #fff;
  padding: 4px;
}
.secret {
  margin-top: 8px;
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  border-radius: 6px;
  background: hsl(var(--muted));
  word-break: break-all;
}
.codes-box {
  padding: 12px;
  border: 1px solid hsl(var(--warning) / 0.3);
  background: hsl(var(--warning) / 0.05);
  border-radius: 8px;
}
.codes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.codes-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--warning));
}
.codes-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.code-item {
  padding: 4px 8px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  border-radius: 6px;
  background: hsl(var(--muted));
}
.form-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 16px;
  padding: 8px 12px;
  font-size: 14px;
  color: hsl(var(--destructive));
  border: 1px solid hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.05);
  border-radius: 8px;
}
.linklike {
  border: 0;
  background: none;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  text-align: center;
}
.linklike:hover {
  color: hsl(var(--foreground));
}
.w-full {
  width: 100%;
}
</style>
