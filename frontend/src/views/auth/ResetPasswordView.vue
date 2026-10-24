<script setup lang="ts">
// 重置密码：URL ?token=；无 token = 死链态（不给必败表单）；成功后引导去登录。
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Key } from "@element-plus/icons-vue";
import { resetPassword } from "@/api/auth";
import { ApiError } from "@/api/client";

const { t } = useTranslation();
const route = useRoute();

const token = computed(() => String(route.query.token ?? ""));
const password = ref("");
const confirm = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const done = ref(false);

async function handleSubmit() {
  error.value = null;
  if (password.value !== confirm.value) {
    error.value = t("page.reset-password.s7");
    return;
  }
  loading.value = true;
  try {
    await resetPassword(token.value, password.value);
    done.value = true;
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.reset-password.s0");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <!-- 成功 -->
  <div v-if="done">
    <div class="head">
      <h1>{{ t("page.reset-password.s4") }}</h1>
      <p>{{ t("page.reset-password.s5") }}</p>
    </div>
    <el-button
      type="primary"
      size="large"
      class="w-full"
      @click="$router.push('/login')"
    >
      {{ t("page.reset-password.s6") }}
    </el-button>
  </div>

  <!-- 死链态：token 缺失（链接损坏/已消费） -->
  <div v-else-if="!token">
    <div class="head">
      <h1>{{ t("page.reset-password.s9") }}</h1>
      <p>{{ t("page.reset-password.s10") }}</p>
    </div>
    <el-button
      type="primary"
      size="large"
      class="w-full"
      @click="$router.push('/forgot-password')"
    >
      {{ t("page.reset-password.s11") }}
    </el-button>
  </div>

  <!-- 表单 -->
  <div v-else>
    <div class="head">
      <h1>{{ t("page.reset-password.s0") }}</h1>
    </div>
    <form
      class="form"
      @submit.prevent="handleSubmit"
    >
      <label class="field">
        <span class="label">{{ t("page.reset-password.s1") }}</span>
        <el-input
          id="password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="••••••••"
          show-password
          required
          minlength="8"
        />
      </label>
      <label class="field">
        <span class="label">{{ t("page.reset-password.s2") }}</span>
        <el-input
          id="confirm"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          placeholder="••••••••"
          show-password
          required
          minlength="8"
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
          <Key />
        </el-icon>
        {{ loading ? t("page.reset-password.s8") : t("page.reset-password.s3") }}
      </el-button>
    </form>
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

.w-full {
  width: 100%;
}
</style>
