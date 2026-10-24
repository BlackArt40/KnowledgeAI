<script setup lang="ts">
// 邮箱验证页：URL ?token= 来自验证邮件（自动消费）；?email=&demoUrl= 来自注册跳转。
// 重发 POST /api/auth/verify-email/resend，60s 倒计时。
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Refresh, CircleCheckFilled } from "@element-plus/icons-vue";
import { resendVerification, verifyEmail } from "@/api/auth";
import { ApiError } from "@/api/client";

const { t } = useTranslation();
const route = useRoute();

const email = computed(() => String(route.query.email ?? "").trim());
const demoUrl = computed(() => String(route.query.demoUrl ?? "").trim());
const verifyToken = String(route.query.token ?? "").trim();

const checking = ref(Boolean(verifyToken));
const verified = ref(false);
const error = ref<string | null>(null);
const resending = ref(false);
const resent = ref(false);
const resendDemoUrl = ref<string | null>(null);
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  if (!verifyToken) return;
  try {
    await verifyEmail(verifyToken);
    verified.value = true;
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.verify-email.s8");
  } finally {
    checking.value = false;
  }
});

function startCountdown() {
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

async function resend() {
  if (!email.value || resending.value) return;
  resending.value = true;
  error.value = null;
  resent.value = false;
  try {
    const data = await resendVerification(email.value);
    resent.value = true;
    startCountdown();
    if (data.demoVerifyUrl) resendDemoUrl.value = data.demoVerifyUrl;
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.verify-email.s8");
  } finally {
    resending.value = false;
  }
}

function goDashboard() {
  window.location.href = "/dashboard";
}
</script>

<template>
  <!-- 已验证 -->
  <div
    v-if="verified"
    class="center"
  >
    <div class="badge success">
      <el-icon :size="32">
        <CircleCheckFilled />
      </el-icon>
    </div>
    <h1>{{ t("page.verify-email.s10") }}</h1>
    <p class="desc">
      {{ t("page.verify-email.s11") }}
    </p>
    <el-button
      type="primary"
      size="large"
      class="w-full mt-8"
      @click="goDashboard"
    >
      {{ t("page.verify-email.s5") }}
    </el-button>
  </div>

  <!-- 待验证 / 消费中 -->
  <div
    v-else
    class="center"
  >
    <div class="badge">
      <el-icon
        :size="32"
        style="color: hsl(var(--primary))"
      >
        <Refresh />
      </el-icon>
    </div>
    <h1>{{ t("page.verify-email.s0") }}</h1>
    <p class="desc">
      {{ t("page.verify-email.s2") }}
      <strong>{{ email || "you@company.com" }}</strong>
      {{ t("page.verify-email.s3") }}
      <br>
      {{ t("page.verify-email.s4") }}
    </p>

    <div
      v-if="demoUrl || resendDemoUrl"
      class="demo-box"
    >
      <p class="demo-title">
        {{ t("page.verify-email.s9") }}
      </p>
      <a
        :href="demoUrl || resendDemoUrl || ''"
        class="demo-link"
      >
        {{ demoUrl || resendDemoUrl }}
      </a>
    </div>

    <p
      v-if="error"
      class="form-error"
    >
      {{ error }}
    </p>

    <el-button
      v-if="checking"
      type="primary"
      size="large"
      class="w-full mt-8"
      disabled
      loading
    />

    <div
      v-else
      class="actions mt-8"
    >
      <el-button
        type="primary"
        size="large"
        class="w-full"
        @click="goDashboard"
      >
        {{ t("page.verify-email.s5") }}
      </el-button>
      <el-button
        size="large"
        class="w-full"
        :disabled="countdown > 0 || resending"
        :loading="resending"
        @click="resend"
      >
        <el-icon v-if="!resending">
          <Refresh />
        </el-icon>
        {{ countdown > 0 ? t("page.verify-email.s1", { s: countdown }) : t("page.verify-email.s6") }}
      </el-button>
      <p
        v-if="resent"
        class="resent"
      >
        {{ t("page.verify-email.s12") }}
      </p>
      <p class="note">
        {{ t("page.verify-email.s7") }} <span class="primary-link">{{ t("page.verify-email.s8") }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.center {
  text-align: center;
}
.badge { display: flex; height: 64px; width: 64px; justify-content: center; margin: 0 auto; border-radius: 16px; background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); }

.badge.success {
  background: hsl(var(--success) / 0.1);
  color: hsl(var(--success));
}
h1 {
  margin: 24px 0 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.desc {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}
.demo-box {
  margin-top: 24px;
  padding: 12px;
  text-align: left;
  border: 1px solid hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.05);
  border-radius: 12px;
}
.demo-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.demo-link {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: hsl(var(--primary));
  word-break: break-all;
}
.form-error { margin: 16px 0 0; }

.actions {
  display: grid;
  gap: 12px;
}
.resent {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--success));
}
.note {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.primary-link {
  color: hsl(var(--primary));
}
.mt-8 {
  margin-top: 32px;
}
.w-full {
  width: 100%;
}
</style>
