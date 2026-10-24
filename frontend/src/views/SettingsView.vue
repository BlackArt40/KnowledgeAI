<script setup lang="ts">
// 设置页（V2，复刻 src/app/(app)/settings/page.tsx）：5 个 tab 与 URL
// ?tab= 双向同步（全局搜索深链接契约）。
// security：2FA（enroll/verify/disable 真流程）+ OAuth 绑定 + 会话 + 登录历史
// profile：资料/密码/语言/通知偏好
// privacy：隐私开关 + 数据保留期 + 导出 + 删除账号（DELETE 确认）
// models：模型配置（ModelSettings）｜ appearance：主题（ThemeSettings）
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { WarningFilled, CopyDocument, Check } from "@element-plus/icons-vue";
import { fetchCurrentUser } from "@/api/auth";
import { ApiError, request } from "@/api/client";
import { oauthSignIn } from "@shared/auth/oauth-signin";
import { formatRelative } from "@shared/format";
import { getI18nInstance } from "@shared/i18n/translate";
import { applyLocale, type Locale } from "@/lib/i18n";
import { currentPlan } from "@/lib/workspace-store";
import { planLabelKey } from "@/lib/plan";
import {
  deleteAccount, fetchSecurity, patchPrivacy, revokeAllSessions, revokeSession, twofa,
  type SecurityState,
} from "@/api/security";
import {
  fetchNotifPrefs, patchNotifPref, type NotifPrefs,
} from "@/api/notifications";
import ModelSettings from "@/components/ModelSettings.vue";
import ThemeSettings from "@/components/ThemeSettings.vue";

const { t } = useTranslation();
const i18n = getI18nInstance();
const route = useRoute();

const TABS = ["security", "profile", "privacy", "models", "appearance"] as const;
type Tab = (typeof TABS)[number];

const tab = ref<Tab>(TABS.includes((route.query.tab as Tab)) ? (route.query.tab as Tab) : "security");

function setTab(v: string | number | boolean) {
  tab.value = (TABS.includes(v as Tab) ? v : "security") as Tab;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", String(tab.value));
  window.history.replaceState(null, "", url.toString());
}

// ── security state ────────────────────────────────────────────────────────
const data = ref<SecurityState | null>(null);
const twoFactorRequired = ref(false);
const loading = ref(true);
const me = ref<{ id: string; name: string; email: string; role: string; plan: string; oauthLinks?: Record<string, string> } | null>(null);
const oauthLinks = ref<Record<string, string>>({});

async function refresh() {
  try {
    const d = await fetchSecurity();
    if (d) data.value = d;
  } catch {
    /* leave null → load error state */
  }
  loading.value = false;
}

async function refreshUser() {
  const u = await fetchCurrentUser().catch(() => null);
  if (u) {
    me.value = u as typeof me.value;
    // 姓名输入框初值跟随当前账号（此前仅在保存后回填，进页面永远是空的）
    if (!profileName.value) profileName.value = u.name ?? "";
    oauthLinks.value = (u as { oauthLinks?: Record<string, string> }).oauthLinks ?? {};
  }
}

onMounted(() => {
  void refresh();
  void refreshUser();
  void refreshNotifPrefs();
});

// ── 2FA enroll / disable ─────────────────────────────────────────────────
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
    await refresh();
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
    await refresh();
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

// ── OAuth 绑定（P3-2）────────────────────────────────────────────────────
const OAUTH_PROVIDERS = ["google", "github"] as const;
const OAUTH_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };
const unbindProvider = ref<string | null>(null);
const unbindBusy = ref(false);
const unbindError = ref<string | null>(null);

async function confirmUnbind() {
  if (!unbindProvider.value) return;
  unbindBusy.value = true;
  unbindError.value = null;
  try {
    const d = await apiDelOauthLink(unbindProvider.value);
    oauthLinks.value = d.oauthLinks ?? {};
    unbindProvider.value = null;
  } catch (e) {
    unbindError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s80");
  } finally {
    unbindBusy.value = false;
  }
}

function apiDelOauthLink(provider: string): Promise<{ oauthLinks?: Record<string, string> }> {
  return request<{ oauthLinks?: Record<string, string> }>(`/api/auth/oauth/link?provider=${provider}`, { method: "DELETE" });
}

// ── sessions / privacy ───────────────────────────────────────────────────
async function doRevokeSession(id: string) {
  try {
    await revokeSession(id);
  } catch {
    /* ignore */
  }
  await refresh();
}
async function doRevokeAll() {
  try {
    await revokeAllSessions();
  } catch {
    /* ignore */
  }
  await refresh();
}
async function doPatchPrivacy(patch: Record<string, unknown>) {
  try {
    await patchPrivacy(patch);
  } catch {
    /* ignore */
  }
  await refresh();
}
function exportData() {
  window.open("/api/security/export", "_blank");
}

// ── profile ──────────────────────────────────────────────────────────────
const profileName = ref("");
const curPwd = ref("");
const newPwd = ref("");
const confirmPwd = ref("");
const profileMsg = ref<{ ok: boolean; text: string } | null>(null);
const savingProfile = ref(false);
const locale = computed(() => i18n.language === "en" ? "en" : "zh-CN");

async function saveProfile() {
  if (!me.value) return;
  profileMsg.value = null;
  if (newPwd.value && newPwd.value !== confirmPwd.value) {
    profileMsg.value = { ok: false, text: t("page.settings.s39") };
    return;
  }
  savingProfile.value = true;
  try {
    const d = await request<{ user?: { name: string }; token?: string; error?: string }>("/api/auth/me", {
      method: "PATCH",
      body: {
        name: profileName.value,
        currentPassword: curPwd.value || undefined,
        newPassword: newPwd.value || undefined,
      },
    });
    if (d && (d as { user?: { name: string } }).user) {
      me.value = { ...me.value, name: d.user!.name };
      profileName.value = d.user!.name;
      curPwd.value = "";
      newPwd.value = "";
      confirmPwd.value = "";
      profileMsg.value = { ok: true, text: t("page.settings.s41") };
    } else {
      profileMsg.value = { ok: false, text: (d as { error?: string })?.error || t("page.settings.s40") };
    }
  } catch (e) {
    profileMsg.value = { ok: false, text: e instanceof ApiError && e.message ? e.message : t("page.settings.s42") };
  } finally {
    savingProfile.value = false;
  }
}

async function setLocale(v: string) {
  const next: Locale = v === "en" ? "en" : "zh-CN";
  // 单源实现：localStorage + cookie + <html lang> 三写（@/lib/i18n）。
  applyLocale(next);
  try {
    await request("/api/auth/me", { method: "PATCH", body: { locale: next } });
  } catch {
    /* 本地偏好已生效；服务端同步失败不阻塞 UI */
  }
}

// ── 通知偏好 ─────────────────────────────────────────────────────────────
const notifPrefs = ref<NotifPrefs | null>(null);
const savingNotif = ref<string | null>(null);

async function refreshNotifPrefs() {
  notifPrefs.value = await fetchNotifPrefs().catch(() => null);
}

async function toggleNotif(key: keyof NotifPrefs, val: boolean) {
  if (!notifPrefs.value) return;
  notifPrefs.value = { ...notifPrefs.value, [key]: val };
  savingNotif.value = key;
  try {
    await patchNotifPref(key, val);
  } catch {
    /* ignore */
  }
  savingNotif.value = null;
}

const NOTIF_ITEMS = computed(() => [
  { k: "emailDigest" as const, label: t("page.settings.s58"), desc: t("page.settings.s59") },
  { k: "kbReady" as const, label: t("page.settings.s60"), desc: t("page.settings.s61") },
  { k: "agentDone" as const, label: t("page.settings.s62"), desc: t("page.settings.s63") },
  { k: "securityAlert" as const, label: t("page.settings.s64"), desc: t("page.settings.s65") },
]);

// ── 删除账号 ─────────────────────────────────────────────────────────────
const deleting = ref(false);
const deleteConfirm = ref("");
const deleteDialogOpen = ref(false);

function openDeleteDialog() {
  deleteConfirm.value = "";
  deleteDialogOpen.value = true;
}

async function doDeleteAccount() {
  deleting.value = true;
  try {
    await deleteAccount();
    window.location.replace("/login");
  } catch (e) {
    profileMsg.value = { ok: false, text: e instanceof ApiError && e.message ? e.message : t("page.settings.s42") };
    deleting.value = false;
  }
}

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

// 套餐读后端当前工作区套餐（与侧栏/工作台同源）
const planLabel = computed(() => {
  const key = planLabelKey(currentPlan.value);
  return key ? t(key) : currentPlan.value || "—";
});
</script>

<template>
  <div class="wrap">
    <div>
      <h1>{{ t("page.settings.s97") }}</h1>
      <p class="sub">
        {{ t("page.settings.s98") }}
      </p>
    </div>

    <div
      v-if="loading"
      class="sk"
      style="height: 320px"
    />
    <div
      v-else-if="!data"
      class="load-err"
    >
      <p>{{ t("page.settings.s42") }}</p>
      <el-button @click="() => { loading = true; void refresh(); }">
        {{ t("common.retry") }}
      </el-button>
    </div>

    <el-tabs
      v-else
      v-model="tab"
      class="tabs"
      @tab-change="setTab"
    >
      <!-- ── Security ─────────────────────────────────────────────────── -->
      <el-tab-pane name="security">
        <template #label>
          {{ t("page.settings.s0") }}
        </template>
        <div class="space">
          <div class="card">
            <div class="card-head between">
              <h3>{{ t("page.settings.s4") }}</h3>
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
              <h3>{{ t("page.settings.s73") }}</h3>
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
              <h3>{{ t("page.settings.s5") }}</h3>
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
              <h3>{{ t("page.settings.s6") }}</h3>
            </div>
            <div class="card-body history kai-scroll">
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
      </el-tab-pane>

      <!-- ── Profile ──────────────────────────────────────────────────── -->
      <el-tab-pane name="profile">
        <template #label>
          {{ t("page.settings.s1") }}
        </template>
        <div class="space">
          <div class="card">
            <div class="card-head">
              <h3>{{ t("page.settings.s99") }}</h3>
            </div>
            <div class="card-body">
              <div class="grid2">
                <label class="field">
                  <span class="label">{{ t("page.settings.s19") }}</span>
                  <el-input
                    v-model="profileName"
                    :placeholder="t('page.settings.s54')"
                  />
                </label>
                <label class="field">
                  <span class="label">{{ t("page.settings.s20") }}</span>
                  <el-input
                    :model-value="me?.email ?? ''"
                    disabled
                  />
                </label>
              </div>
              <div class="pills">
                <span class="badge outline">{{ me ? ROLE_BADGE[me.role] ?? me.role : "—" }}</span>
                <span class="badge">{{ planLabel }}</span>
                <span class="hint">{{ t("page.settings.s21") }}</span>
              </div>
              <div class="lang-row">
                <div>
                  <span class="label">{{ t("common.language") }}</span>
                  <p class="hint">
                    {{ t("page.settings.langHint") }}
                  </p>
                </div>
                <el-select
                  :model-value="locale"
                  style="width: 144px"
                  :aria-label="t('common.language')"
                  @update:model-value="setLocale"
                >
                  <el-option
                    value="zh-CN"
                    :label="t('page.settings.s7')"
                  />
                  <el-option
                    value="en"
                    :label="t('common.english')"
                  />
                </el-select>
              </div>
              <div class="divider" />
              <label class="field">
                <span class="label">{{ t("page.settings.s22") }}</span>
                <el-input
                  v-model="curPwd"
                  type="password"
                  show-password
                  :placeholder="t('page.settings.s55')"
                />
              </label>
              <div class="grid2">
                <label class="field">
                  <span class="label">{{ t("page.settings.s23") }}</span>
                  <el-input
                    v-model="newPwd"
                    type="password"
                    show-password
                    :placeholder="t('page.settings.s56')"
                  />
                </label>
                <label class="field">
                  <span class="label">{{ t("page.settings.s24") }}</span>
                  <el-input
                    v-model="confirmPwd"
                    type="password"
                    show-password
                    :placeholder="t('page.settings.s57')"
                  />
                </label>
              </div>
              <p
                v-if="profileMsg"
                class="hint"
                :class="profileMsg.ok ? 'ok' : 'err'"
              >
                {{ profileMsg.ok ? "✓ " : "✗ " }}{{ profileMsg.text }}
              </p>
              <div>
                <el-button
                  type="primary"
                  :loading="savingProfile"
                  @click="saveProfile"
                >
                  {{ t("page.settings.s89") }}
                </el-button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>{{ t("page.settings.s90") }}</h3>
            </div>
            <div class="card-body">
              <div
                v-for="n in NOTIF_ITEMS"
                :key="n.k"
                class="pref-row"
              >
                <div>
                  <p class="pref-label">
                    {{ n.label }}
                  </p>
                  <p class="hint">
                    {{ n.desc }}
                  </p>
                </div>
                <div class="pref-right">
                  <el-icon
                    v-if="savingNotif === n.k"
                    class="spin"
                    :size="13"
                  >
                    <Loading />
                  </el-icon>
                  <el-switch
                    :model-value="notifPrefs ? notifPrefs[n.k] : false"
                    :disabled="!notifPrefs"
                    :aria-label="n.label"
                    @update:model-value="(v: string | number | boolean) => toggleNotif(n.k, !!v)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ── Privacy ──────────────────────────────────────────────────── -->
      <el-tab-pane name="privacy">
        <template #label>
          {{ t("page.settings.s2") }}
        </template>
        <div class="space">
          <div class="card">
            <div class="card-head">
              <h3>{{ t("page.settings.s8") }}</h3>
            </div>
            <div class="card-body">
              <div class="pref-row">
                <div>
                  <p class="pref-label">
                    {{ t("page.settings.s66") }}
                  </p>
                  <p class="hint">
                    {{ t("page.settings.s67") }}
                  </p>
                </div>
                <el-switch
                  :model-value="data.privacy.analytics"
                  :aria-label="t('page.settings.s66')"
                  @update:model-value="(v: string | number | boolean) => doPatchPrivacy({ analytics: !!v })"
                />
              </div>
              <div class="pref-row">
                <div>
                  <p class="pref-label">
                    {{ t("page.settings.s68") }}
                  </p>
                  <p class="hint">
                    {{ t("page.settings.s69") }}
                  </p>
                </div>
                <el-switch
                  :model-value="data.privacy.crashReports"
                  :aria-label="t('page.settings.s68')"
                  @update:model-value="(v: string | number | boolean) => doPatchPrivacy({ crashReports: !!v })"
                />
              </div>
              <div class="pref-row">
                <div>
                  <p class="pref-label">
                    {{ t("page.settings.s70") }}
                  </p>
                  <p class="hint">
                    {{ t("page.settings.s71") }}
                  </p>
                </div>
                <el-switch
                  :model-value="data.privacy.trainingOptIn"
                  :aria-label="t('page.settings.s70')"
                  @update:model-value="(v: string | number | boolean) => doPatchPrivacy({ trainingOptIn: !!v })"
                />
              </div>
              <div class="divider" />
              <div class="pref-row">
                <div>
                  <p class="pref-label">
                    {{ t("page.settings.s26") }}
                  </p>
                  <p class="hint">
                    {{ t("page.settings.s27") }}
                  </p>
                </div>
                <el-select
                  :model-value="String(data.privacy.dataRetentionDays)"
                  style="width: 120px"
                  :aria-label="t('page.settings.s26')"
                  @update:model-value="(v: string | number | boolean) => doPatchPrivacy({ dataRetentionDays: Number(v) })"
                >
                  <el-option
                    value="30"
                    :label="t('page.settings.s28')"
                  />
                  <el-option
                    value="60"
                    :label="t('page.settings.s29')"
                  />
                  <el-option
                    value="90"
                    :label="t('page.settings.s30')"
                  />
                  <el-option
                    value="180"
                    :label="t('page.settings.s31')"
                  />
                  <el-option
                    value="365"
                    :label="t('page.settings.s32')"
                  />
                </el-select>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>{{ t("page.settings.s33") }}</h3>
            </div>
            <div class="card-body">
              <p class="hint">
                {{ t("page.settings.s91") }}
              </p>
              <div class="btns">
                <el-button @click="exportData">
                  {{ t("page.settings.s92") }}
                </el-button>
                <el-button
                  type="danger"
                  @click="openDeleteDialog"
                >
                  {{ t("page.settings.s93") }}
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ── Models ───────────────────────────────────────────────────── -->
      <el-tab-pane name="models">
        <template #label>
          {{ t("page.settings.s3") }}
        </template>
        <ModelSettings />
      </el-tab-pane>

      <!-- ── Appearance ───────────────────────────────────────────────── -->
      <el-tab-pane name="appearance">
        <template #label>
          {{ t("page.settings.s72") }}
        </template>
        <ThemeSettings />
      </el-tab-pane>
    </el-tabs>

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

    <!-- 删除账号确认 -->
    <el-dialog
      v-model="deleteDialogOpen"
      :title="t('page.settings.s9')"
      width="420px"
    >
      <p class="hint">
        {{ t("page.settings.s94") }}<strong>{{ t("page.settings.s35") }}</strong>。
      </p>
      <div class="alert-box">
        {{ t("page.settings.s95") }}
      </div>
      <label class="field">
        <span class="label">{{ t("page.settings.s10") }}<strong>DELETE</strong>{{ t("page.settings.s11") }}</span>
        <el-input
          v-model="deleteConfirm"
          placeholder="DELETE"
        />
      </label>
      <template #footer>
        <el-button @click="deleteDialogOpen = false">
          {{ t("page.settings.s38") }}
        </el-button>
        <el-button
          type="danger"
          :disabled="deleting || deleteConfirm !== 'DELETE'"
          :loading="deleting"
          @click="doDeleteAccount"
        >
          {{ t("page.settings.s96") }}
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
  gap: 24px;
}
.wrap h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sub {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.space {
  display: grid;
  gap: 16px;
}
.card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
}
.card-head {
  padding: 16px 20px 0;
}
.card-head.between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.card-body {
  padding: 12px 20px 20px;
  display: grid;
  gap: 12px;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.hint.ok {
  color: hsl(var(--primary));
}
.hint.err {
  color: hsl(var(--destructive));
}
.info-box,
.alert-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
}
.info-box {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.4);
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.alert-box {
  border: 1px solid hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.05);
  color: hsl(var(--destructive));
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.badge.success {
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.badge.warn {
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
}
.badge.outline {
  border: 1px solid hsl(var(--border));
  background: none;
}
.row-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
}
.row-icon {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: hsl(var(--muted));
  font-size: 13px;
  font-weight: 600;
}
.row-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.row-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}
.row-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.history {
  max-height: 256px;
  overflow-y: auto;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.history-row:hover {
  background: hsl(var(--accent) / 0.5);
}
.history-row .ok {
  color: hsl(var(--success));
}
.history-row .err {
  color: hsl(var(--destructive));
}
.history-main {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
}
.grid2 {
  display: grid;
  gap: 16px;
}
@media (min-width: 640px) {
  .grid2 {
    grid-template-columns: 1fr 1fr;
  }
}
.pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.lang-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.divider {
  height: 1px;
  background: hsl(var(--border));
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.pref-row .hint {
  margin-top: 2px;
}
.pref-label {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.pref-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btns {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.enroll {
  display: grid;
  gap: 10px;
  justify-items: center;
}
.qr {
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: #fff;
  padding: 4px;
}
.secret {
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  background: hsl(var(--muted));
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
  text-align: center;
}
.codes-box {
  width: 100%;
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
.load-err {
  display: grid;
  gap: 12px;
  justify-items: center;
  padding: 40px 0;
  color: hsl(var(--muted-foreground));
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.sk {
  border-radius: 12px;
  background: hsl(var(--muted));
  animation: pulse 1.5s ease-in-out infinite;
}
/* 窄屏：标签栏可横向滚动，避免把 grid 列撑宽导致整页横向溢出 */
.tabs {
  min-width: 0;
}
.tabs :deep(.el-tabs__nav-wrap) {
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs :deep(.el-tabs__nav-wrap)::-webkit-scrollbar {
  display: none;
}
@media (max-width: 639px) {
  .lang-row {
    flex-wrap: wrap;
  }
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
