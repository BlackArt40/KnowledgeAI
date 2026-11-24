<script setup lang="ts">
import { ref } from "vue";
import { useTranslation } from "i18next-vue";
import { WarningFilled, CopyDocument, Check } from "@element-plus/icons-vue";
import { oauthSignIn } from "@kai/shared/auth/oauth-signin";
import { formatRelative } from "@kai/shared/format";
import { ApiError, request } from "@/api/client";
import {
  revokeAllSessions,
  revokeSession,
  twofa,
  type SecurityState,
} from "@/api/security";

const { t } = useTranslation();
defineProps<{
  data: SecurityState;
  oauthLinks: Record<string, string>;
}>();
const emit = defineEmits<{
  refresh: [];
  "update:oauthLinks": [Record<string, string>];
}>();
const twoFactorRequired = false;

const enrollOpen = ref(false);
const enrollData = ref<{ secret: string; qrCodeDataUrl: string; backupCodes: string[] } | null>(null);
const enrollCode = ref("");
const enrollBusy = ref(false);
const enrollError = ref<string | null>(null);
const copied = ref(false);
const disableOpen = ref(false);
const disableCode = ref("");
const disableBusy = ref(false);
const disableError = ref<string | null>(null);

async function startEnroll() {
  enrollError.value = null;
  enrollData.value = null;
  enrollCode.value = "";
  enrollOpen.value = true;
  try {
    const d = await twofa("enroll");
    if (!d?.secret) {
      enrollError.value = t("page.settings.s43");
      return;
    }
    enrollData.value = { secret: d.secret, qrCodeDataUrl: d.qrCodeDataUrl ?? "", backupCodes: d.backupCodes ?? [] };
  } catch {
    enrollError.value = t("page.settings.s42");
  }
}

async function confirmEnroll() {
  enrollError.value = null;
  if (!/^\d{6}$/.test(enrollCode.value.trim())) {
    enrollError.value = t("page.settings.s44");
    return;
  }
  enrollBusy.value = true;
  try {
    const d = await twofa("verify", enrollCode.value.trim());
    if (!d) {
      enrollError.value = t("page.settings.s45");
      return;
    }
    enrollOpen.value = false;
    emit("refresh");
  } catch (e) {
    enrollError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s42");
  } finally {
    enrollBusy.value = false;
  }
}

async function confirmDisable() {
  disableError.value = null;
  if (!disableCode.value.trim()) {
    disableError.value = t("page.settings.s46");
    return;
  }
  disableBusy.value = true;
  try {
    const d = await twofa("disable", disableCode.value.trim());
    if (!d) {
      disableError.value = t("page.settings.s45");
      return;
    }
    disableOpen.value = false;
    disableCode.value = "";
    emit("refresh");
  } catch (e) {
    disableError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s42");
  } finally {
    disableBusy.value = false;
  }
}

async function copyBackupCodes() {
  if (!enrollData.value) return;
  await navigator.clipboard?.writeText(enrollData.value.backupCodes.join("\n"));
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

const OAUTH_PROVIDERS = ["google", "github"] as const;
const OAUTH_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };
const unbindProvider = ref<string | null>(null);
const unbindBusy = ref(false);
const unbindError = ref<string | null>(null);

function apiDelOauthLink(provider: string): Promise<{ oauthLinks?: Record<string, string> }> {
  return request<{ oauthLinks?: Record<string, string> }>(`/api/auth/oauth/link?provider=${provider}`, { method: "DELETE" });
}

async function confirmUnbind() {
  if (!unbindProvider.value) return;
  unbindBusy.value = true;
  unbindError.value = null;
  try {
    const d = await apiDelOauthLink(unbindProvider.value);
    emit("update:oauthLinks", d.oauthLinks ?? {});
    unbindProvider.value = null;
  } catch (e) {
    unbindError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s80");
  } finally {
    unbindBusy.value = false;
  }
}

async function doRevokeSession(id: string) {
  try { await revokeSession(id); } catch { /* ignore */ }
  emit("refresh");
}
async function doRevokeAll() {
  try { await revokeAllSessions(); } catch { /* ignore */ }
  emit("refresh");
}
</script>

<template>
  <div class="space">
    <div class="card">
      <div class="card-head between">
        <h2>{{ t("page.settings.s4") }}</h2>
        <span
          class="badge"
          :class="data.twoFactor.enabled ? 'success' : 'warn'"
        >
          {{ data.twoFactor.enabled ? t("page.settings.s48") : t("page.settings.s49") }}
        </span>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.settings.s81") }}
        </p>
        <template v-if="data.twoFactor.enabled">
          <p
            v-if="data.twoFactor.enrolledAt"
            class="hint"
          >
            {{ t("page.settings.s82", { time: formatRelative(data.twoFactor.enrolledAt) }) }}
          </p>
          <div class="info-box">
            <p class="hint">
              {{ t("page.settings.s83", { count: data.twoFactor.backupCodesRemaining }) }}
            </p>
            <p class="hint">
              {{ t("page.settings.s84") }}
            </p>
          </div>
          <el-button @click="() => { disableError = null; disableCode = ''; disableOpen = true; }">
            {{ t("page.settings.s13") }}
          </el-button>
        </template>
        <template v-else>
          <div
            v-if="twoFactorRequired"
            class="alert-box"
          >
            {{ t("page.settings.s7") }}
          </div>
          <el-button
            type="primary"
            @click="startEnroll"
          >
            {{ t("page.settings.s85") }}
          </el-button>
        </template>
      </div>
    </div>

    <!-- OAuth 绑定 -->
    <div class="card">
      <div class="card-head">
        <h2>{{ t("page.settings.s73") }}</h2>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.settings.s74") }}
        </p>
        <div
          v-for="p in OAUTH_PROVIDERS"
          :key="p"
          class="row-box"
        >
          <span class="row-icon">{{ OAUTH_LABEL[p].charAt(0) }}</span>
          <span class="row-main">
            <span class="row-title">{{ OAUTH_LABEL[p] }}</span>
            <span
              v-if="oauthLinks[p]"
              class="badge success"
            >{{ t("page.settings.s75") }}</span>
          </span>
          <el-button
            v-if="oauthLinks[p]"
            size="small"
            @click="unbindProvider = p"
          >
            {{ t("page.settings.s76") }}
          </el-button>
          <el-button
            v-else
            size="small"
            @click="oauthSignIn({ provider: p, callbackUrl: '/api/auth/oauth/bridge?cb=%2Fsettings%3Ftab%3Dsecurity' })"
          >
            {{ t("page.settings.s77") }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 会话 -->
    <div class="card">
      <div class="card-head between">
        <h2>{{ t("page.settings.s5") }}</h2>
        <el-button
          size="small"
          text
          @click="doRevokeAll"
        >
          {{ t("page.settings.s16") }}
        </el-button>
      </div>
      <div class="card-body">
        <div
          v-for="s in data.sessions"
          :key="s.id"
          class="row-box"
        >
          <span class="row-main">
            <span class="row-title">
              {{ s.device }}
              <span
                v-if="s.current"
                class="badge success"
              >{{ t("page.settings.s17") }}</span>
            </span>
            <span class="row-sub">{{ s.browser }} · {{ s.ip }} · {{ s.location }} · {{ formatRelative(s.lastActive) }}</span>
          </span>
          <el-button
            v-if="!s.current"
            size="small"
            text
            type="danger"
            @click="doRevokeSession(s.id)"
          >
            {{ t("common.delete") }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 登录历史 -->
    <div class="card">
      <div class="card-head">
        <h2>{{ t("page.settings.s6") }}</h2>
      </div>
      <!-- 可滚动列表需要键盘可达（axe: scrollable-region-focusable） -->
      <div
        class="card-body history kai-scroll"
        tabindex="0"
      >
        <div
          v-for="e in data.loginHistory"
          :key="e.id"
          class="history-row"
        >
          <span :class="e.success ? 'ok' : 'err'">{{ e.success ? "✓" : "!" }}</span>
          <span class="history-main">{{ e.device }} · {{ e.location }}</span>
          <span class="mono">{{ e.ip }}</span>
          <span>{{ formatRelative(e.ts) }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 2FA enroll 对话框 -->
  <el-dialog
    v-model="enrollOpen"
    :title="t('page.settings.s8')"
    width="420px"
    @closed="enrollError = null"
  >
    <p
      v-if="enrollError"
      class="alert-box"
    >
      <el-icon><WarningFilled /></el-icon> {{ enrollError }}
    </p>
    <template v-if="enrollData">
      <div class="enroll">
        <p class="hint">
          {{ t("page.settings.s9") }}
        </p>
        <img
          :src="enrollData.qrCodeDataUrl"
          :alt="t('page.settings.s50')"
          width="180"
          height="180"
          class="qr"
        >
        <p class="hint">
          {{ t("page.settings.s10") }}
        </p>
        <code class="secret">{{ enrollData.secret }}</code>
        <div class="codes-box">
          <div class="codes-head">
            <span class="codes-title">{{ t("page.settings.s11") }}</span>
            <el-button
              size="small"
              text
              @click="copyBackupCodes"
            >
              <el-icon v-if="copied">
                <Check />
              </el-icon>
              <el-icon v-else>
                <CopyDocument />
              </el-icon>
              {{ copied ? t("page.settings.s51") : t("page.settings.s52") }}
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
        <label class="field">
          <span class="label">{{ t("page.settings.s12") }}</span>
          <el-input
            v-model="enrollCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="123456"
          />
        </label>
      </div>
      <div style="margin-top: 14px">
        <el-button
          type="primary"
          class="w-full"
          :loading="enrollBusy"
          @click="confirmEnroll"
        >
          {{ t("page.settings.s86") }}
        </el-button>
      </div>
    </template>
    <div
      v-else
      class="hint"
      style="padding: 32px 0; text-align: center"
    >
      {{ t("page.settings.s87") }}
    </div>
  </el-dialog>

  <!-- 2FA disable 对话框 -->
  <el-dialog
    v-model="disableOpen"
    :title="t('page.settings.s13')"
    width="360px"
    @closed="disableError = null"
  >
    <p
      v-if="disableError"
      class="alert-box"
    >
      {{ disableError }}
    </p>
    <p class="hint">
      {{ t("page.settings.s14") }}
    </p>
    <el-input
      v-model="disableCode"
      inputmode="numeric"
      autocomplete="one-time-code"
      :placeholder="t('page.settings.s53')"
    />
    <template #footer>
      <el-button @click="disableOpen = false">
        {{ t("common.cancel") }}
      </el-button>
      <el-button
        type="danger"
        :loading="disableBusy"
        @click="confirmDisable"
      >
        {{ t("page.settings.s88") }}
      </el-button>
    </template>
  </el-dialog>

  <!-- OAuth 解绑确认 -->
  <el-dialog
    :model-value="unbindProvider !== null"
    :title="t('page.settings.s78')"
    width="360px"
    @update:model-value="(v: boolean) => { if (!v) { unbindProvider = null; unbindError = null; } }"
  >
    <p
      v-if="unbindError"
      class="alert-box"
    >
      {{ unbindError }}
    </p>
    <p class="hint">
      {{ unbindProvider ? t("page.settings.s79", { provider: OAUTH_LABEL[unbindProvider] ?? unbindProvider }) : "" }}
    </p>
    <template #footer>
      <el-button @click="() => { unbindProvider = null; unbindError = null; }">
        {{ t("common.cancel") }}
      </el-button>
      <el-button
        type="danger"
        :loading="unbindBusy"
        @click="confirmUnbind"
      >
        {{ t("page.settings.s76") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="../settings.css"></style>
