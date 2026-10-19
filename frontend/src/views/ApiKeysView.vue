<script setup lang="ts">
// API 密钥页（V3，复刻 /api-keys）：列表（脱敏）+ 创建（一次性明文展示 +
// 复制提醒）+ 启停 + 撤销。scope 白名单与 /lib/apikeys/types 一致。
import { onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { CopyDocument, Check } from "@element-plus/icons-vue";
import {
  createKey, fetchKeys, revokeKey, SCOPES,
  type ApiKey,
} from "@/api/apikeys";
import { ApiError } from "@/api/client";
import { formatRelative } from "@shared/format";

const { t } = useTranslation();

const keys = ref<ApiKey[]>([]);
const loading = ref(true);
const createOpen = ref(false);
const creating = ref(false);
const createError = ref<string | null>(null);
const form = ref({ name: "", scopes: ["kb:read"] as string[] });
// 一次性明文 secret（仅创建响应返回）
const createdSecret = ref<string | null>(null);
const copied = ref(false);
const actionError = ref<string | null>(null);

async function refresh() {
  try {
    keys.value = await fetchKeys();
  } catch {
    /* ignore */
  }
  loading.value = false;
}

onMounted(refresh);

async function submitCreate() {
  if (!form.value.name.trim() || form.value.scopes.length === 0) return;
  creating.value = true;
  createError.value = null;
  try {
    const key = await createKey(form.value.name.trim(), form.value.scopes);
    createOpen.value = false;
    createdSecret.value =
      (key as unknown as { secret?: string }).secret ?? JSON.stringify(key);
    form.value = { name: "", scopes: ["kb:read"] };
    await refresh();
  } catch (e) {
    createError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s42");
  } finally {
    creating.value = false;
  }
}

async function copySecret() {
  if (!createdSecret.value) return;
  await navigator.clipboard?.writeText(createdSecret.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

async function revoke(id: string) {
  if (!window.confirm(t("page.api-keys.s23") || t("page.api-keys.s23"))) return;
  actionError.value = null;
  try {
    await revokeKey(id);
    await refresh();
  } catch (e) {
    actionError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
  }
}

function keyDisplay(k: ApiKey): string {
  const prefix = (k as unknown as { prefix?: string }).prefix;
  const mask = (k as unknown as { masked?: string; last4?: string }).masked;
  return mask ?? prefix ?? "••••";
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h2>{{ t("page.api-keys.s1") }}</h2>
        <p class="sub">
          {{ t("page.api-keys.s1") }}
        </p>
      </div>
      <el-button
        type="primary"
        @click="createOpen = true; createError = null"
      >
        {{ t("page.api-keys.s0") }}
      </el-button>
    </div>

    <div
      v-if="loading"
      class="sk"
      style="height: 180px"
    />
    <div
      v-else-if="keys.length === 0"
      class="empty"
    >
      <p>{{ t("page.api-keys.s0") }}</p>
      <el-button
        type="primary"
        plain
        @click="createOpen = true"
      >
        {{ t("page.api-keys.s0") }}
      </el-button>
    </div>

    <template v-else>
      <p
        v-if="actionError"
        class="err"
      >
        {{ actionError }}
      </p>
      <div
        v-for="k in keys"
        :key="k.id"
        class="card key-row"
      >
        <div class="key-main">
          <span class="key-name">
            {{ k.name }}
            <span
              v-if="(k as { enabled?: boolean }).enabled === false"
              class="badge"
            >{{ t("page.api-keys.s21") }}</span>
          </span>
          <span class="key-meta">
            <span class="mono">{{ keyDisplay(k) }}</span>
            · {{ formatRelative(k.createdAt) }}
            <span v-if="k.lastUsedAt"> · {{ t("page.api-keys.s5") }} {{ formatRelative(k.lastUsedAt) }}</span>
          </span>
          <span class="scopes">
            <span
              v-for="s in k.scopes"
              :key="s"
              class="badge scope"
            >{{ s }}</span>
          </span>
        </div>
        <el-button
          size="small"
          type="danger"
          plain
          @click="revoke(k.id)"
        >
          {{ t("page.api-keys.s23") }}
        </el-button>
      </div>
    </template>

    <el-dialog
      v-model="createOpen"
      :title="t('page.api-keys.s2')"
      width="440px"
      @closed="createError = null"
    >
      <div class="form">
        <label class="field">
          <span class="label">{{ t("page.model-settings.s38") }}</span>
          <el-input
            v-model="form.name"
            :placeholder="t('page.api-keys.s8')"
            required
          />
        </label>
        <div class="field">
          <span class="label">{{ t("page.api-keys.s4") }}</span>
          <el-checkbox-group v-model="form.scopes">
            <el-checkbox
              v-for="s in SCOPES"
              :key="s.id"
              :value="s.id"
            >
              {{ s.label }}（{{ s.id }}）
            </el-checkbox>
          </el-checkbox-group>
        </div>
        <p
          v-if="createError"
          class="err"
        >
          {{ createError }}
        </p>
      </div>
      <template #footer>
        <el-button @click="createOpen = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="submitCreate"
        >
          {{ t("common.create") }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 一次性明文 secret -->
    <el-dialog
      :model-value="createdSecret !== null"
      :title="t('page.api-keys.s10')"
      width="480px"
      @update:model-value="(v: boolean) => { if (!v) createdSecret = null; }"
    >
      <div class="secret-box">
        <p class="hint">
          {{ t("page.api-keys.s5") }}
        </p>
        <code class="secret">{{ createdSecret }}</code>
      </div>
      <template #footer>
        <el-button @click="copySecret">
          <el-icon v-if="copied">
            <Check />
          </el-icon>
          <el-icon v-else>
            <CopyDocument />
          </el-icon>
          {{ copied ? t("page.2fa-enroll.s8") : t("common.copy") }}
        </el-button>
        <el-button
          type="primary"
          @click="createdSecret = null"
        >
          {{ t("common.close") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 56rem;
  margin: 0 auto;
  display: grid;
  gap: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.sub {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
}
.key-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}
.key-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.key-meta {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.badge.scope {
  font-family: var(--font-mono);
}
.mono {
  font-family: var(--font-mono);
}
.empty {
  display: grid;
  gap: 12px;
  justify-items: center;
  padding: 60px 0;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
}
.form {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.secret {
  display: block;
  padding: 10px 12px;
  border: 1px dashed hsl(var(--warning) / 0.4);
  background: hsl(var(--warning) / 0.05);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  word-break: break-all;
}
.err {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}
.sk {
  border-radius: 12px;
  background: hsl(var(--muted));
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
