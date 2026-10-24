<script setup lang="ts">
// 忘记密码：POST /api/auth/forgot-password；demo 模式响应体带 demoResetUrl（仅本地）。
import { ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Message, ArrowLeft } from "@element-plus/icons-vue";
import { forgotPassword } from "@/api/auth";
import { ApiError } from "@/api/client";

const { t } = useTranslation();

const email = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const submitted = ref(false);
const demoUrl = ref<string | null>(null);

async function handleSubmit() {
  error.value = null;
  loading.value = true;
  try {
    const data = await forgotPassword(email.value);
    submitted.value = true;
    if (data.demoResetUrl) demoUrl.value = data.demoResetUrl;
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.forgot-password.s0");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div v-if="submitted">
    <div class="head">
      <h1>{{ t("page.forgot-password.s5") }}</h1>
      <p>{{ t("page.forgot-password.s6") }}</p>
    </div>
    <div
      v-if="demoUrl"
      class="demo-box"
    >
      <p class="demo-title">
        {{ t("page.forgot-password.s7") }}
      </p>
      <a
        :href="demoUrl"
        class="demo-link"
      >{{ demoUrl }}</a>
    </div>
    <el-button
      class="w-full"
      @click="submitted = false"
    >
      <el-icon><ArrowLeft /></el-icon>
      <router-link
        to="/login"
        class="plain-link"
      >
        {{ t("page.forgot-password.s4") }}
      </router-link>
    </el-button>
  </div>

  <div v-else>
    <div class="head">
      <h1>{{ t("page.forgot-password.s0") }}</h1>
      <p>{{ t("page.forgot-password.s1") }}</p>
    </div>
    <form
      class="form"
      @submit.prevent="handleSubmit"
    >
      <label class="field">
        <span class="label">{{ t("page.forgot-password.s2") }}</span>
        <el-input
          id="email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
          required
        />
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
          <Message />
        </el-icon>
        {{ loading ? t("page.forgot-password.s8") : t("page.forgot-password.s3") }}
      </el-button>
    </form>
    <p class="foot">
      <router-link
        to="/login"
        class="back-link"
      >
        <el-icon :size="12">
          <ArrowLeft />
        </el-icon> {{ t("page.forgot-password.s4") }}
      </router-link>
    </p>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 32px;
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
.demo-box {
  margin-bottom: 24px;
  padding: 12px;
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
.form-error { margin: 0; }

.foot {
  margin-top: 24px;
  text-align: center;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}
.back-link:hover {
  color: hsl(var(--foreground));
}
.plain-link {
  color: inherit;
  text-decoration: none;
}
.w-full {
  width: 100%;
}
</style>
