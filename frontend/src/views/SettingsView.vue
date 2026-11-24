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
import { fetchCurrentUser } from "@/api/auth";
import { ApiError, request } from "@/api/client";
import { getI18nInstance } from "@kai/shared/i18n/translate";
import { applyLocale, type Locale } from "@/lib/i18n";
import { currentPlan } from "@/lib/workspace-store";
import { planLabelKey } from "@/lib/plan";
import {
  deleteAccount, fetchSecurity,
  type SecurityState,
} from "@/api/security";
import {
  fetchNotifPrefs, patchNotifPref, type NotifPrefs,
} from "@/api/notifications";
import ModelSettings from "@/components/ModelSettings.vue";
import ThemeSettings from "@/components/ThemeSettings.vue";
import DeleteAccountDialog from "./settings/DeleteAccountDialog.vue";
import PrivacyTab from "./settings/PrivacyTab.vue";
import NotificationPrefsCard from "./settings/NotificationPrefsCard.vue";
import SecurityTab from "./settings/SecurityTab.vue";

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
  { k: "teamActivity" as const, label: t("page.settings.s15"), desc: t("page.settings.s18") },
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
        <SecurityTab
          :data="data"
          :oauth-links="oauthLinks"
          @refresh="refresh"
          @update:oauth-links="oauthLinks = $event"
        />
      </el-tab-pane>

      <!-- ── Profile ──────────────────────────────────────────────────── -->
      <el-tab-pane name="profile">
        <template #label>
          {{ t("page.settings.s1") }}
        </template>
        <div class="space">
          <div class="card">
            <div class="card-head">
              <h2>{{ t("page.settings.s99") }}</h2>
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

          <NotificationPrefsCard
            :items="NOTIF_ITEMS"
            :prefs="notifPrefs"
            :saving="savingNotif"
            @toggle="(k: string, v: boolean) => toggleNotif(k as keyof NotifPrefs, v)"
          />
        </div>
      </el-tab-pane>

      <!-- ── Privacy ──────────────────────────────────────────────────── -->
      <el-tab-pane name="privacy">
        <template #label>
          {{ t("page.settings.s2") }}
        </template>
        <PrivacyTab
          :privacy="data.privacy"
          @changed="refresh"
          @delete="openDeleteDialog"
        />
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

    <DeleteAccountDialog
      v-model="deleteDialogOpen"
      v-model:confirm="deleteConfirm"
      :deleting="deleting"
      @confirm="doDeleteAccount"
    />
  </div>
</template>

<style scoped src="./settings.css"></style>
