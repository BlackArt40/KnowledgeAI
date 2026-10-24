<script setup lang="ts">
// 注册页（契约冻结）：POST /api/auth/register {name,email,password}；
// needsVerification → /verify-email?email=&demoUrl=；否则 /dashboard。
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { fetchCurrentUser, register, fetchOAuthProviders } from "@/api/auth";
import { ApiError } from "@/api/client";
import { oauthSignIn } from "@shared/auth/oauth-signin";

const { t } = useTranslation();
const router = useRouter();

const agree = ref(false);
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);
const oauthProviders = ref<string[]>([]);

onMounted(async () => {
  const user = await fetchCurrentUser();
  if (user) {
    window.location.href = "/dashboard";
    return;
  }
  oauthProviders.value = await fetchOAuthProviders();
});

async function handleSubmit() {
  error.value = null;
  if (!agree.value) return;
  loading.value = true;
  try {
    const data = await register(name.value, email.value, password.value);
    if (data.needsVerification) {
      const emailParam = encodeURIComponent(data.user?.email ?? email.value);
      const demoToken = data.demoVerifyUrl ? `&demoUrl=${encodeURIComponent(data.demoVerifyUrl)}` : "";
      await router.push(`/verify-email?email=${emailParam}${demoToken}`);
    } else {
      window.location.href = "/dashboard";
    }
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("page.register.s6");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <div class="head">
      <h1>{{ t("page.register.s0") }}</h1>
      <p>{{ t("page.register.s14") }}</p>
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
        {{ t("page.register.s12") }}
      </el-button>
      <el-button
        v-if="oauthProviders.includes('github')"
        class="w-full h-11"
        @click="oauthSignIn({ provider: 'github' })"
      >
        {{ t("page.register.s13") }}
      </el-button>
    </div>
    <div
      v-if="oauthProviders.length > 0"
      class="sep"
    >
      <span class="sep-line" />
      <span class="sep-text">{{ t("page.register.s1") }}</span>
      <span class="sep-line" />
    </div>

    <form
      class="form"
      @submit.prevent="handleSubmit"
    >
      <label class="field">
        <span class="label">{{ t("page.register.s2") }}</span>
        <el-input
          id="name"
          v-model="name"
          :placeholder="t('page.register.s7')"
          required
        />
      </label>
      <label class="field">
        <span class="label">{{ t("page.register.s3") }}</span>
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
        <span class="label">{{ t("page.register.s4") }}</span>
        <el-input
          id="password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          :placeholder="t('page.register.s8')"
          show-password
          required
        />
      </label>

      <label class="agree">
        <input
          v-model="agree"
          type="checkbox"
        >
        <span>
          {{ t("page.register.s15") }}
          <router-link
            to="/terms"
            class="primary-link"
          >{{ t("page.register.s16") }}</router-link>
          {{ t("page.register.s17") }}
          <router-link
            to="/privacy"
            class="primary-link"
          >{{ t("page.register.s18") }}</router-link>
        </span>
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
        :disabled="!agree"
        :loading="loading"
        native-type="submit"
      >
        {{ loading ? t("page.register.s11") : t("page.register.s0") }}
      </el-button>
    </form>

    <p class="foot">
      {{ t("page.register.s19") }}
      <router-link
        to="/login"
        class="primary-link"
      >
        {{ t("page.register.s20") }}
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
.label {
  font-size: 14px;
  font-weight: 500;
}
.agree {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.agree input {
  margin-top: 2px;
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  accent-color: hsl(var(--primary));
}
.form-error { margin: 0; }

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
