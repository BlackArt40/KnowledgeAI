<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import NotificationPrefsCard from "./NotificationPrefsCard.vue";

const { t } = useTranslation();
const ROLE_BADGE: Record<string, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const profileName = defineModel<string>("profileName", { required: true });
const curPwd = defineModel<string>("curPwd", { required: true });
const newPwd = defineModel<string>("newPwd", { required: true });
const confirmPwd = defineModel<string>("confirmPwd", { required: true });
defineProps<{
  me: { email: string; role: string } | null;
  planLabel: string;
  locale: string;
  profileMsg: { ok: boolean; text: string } | null;
  savingProfile: boolean;
  notifItems: { k: string; label: string; desc: string }[];
  notifPrefs: Record<string, boolean> | null;
  savingNotif: string | null;
}>();
const emit = defineEmits<{
  save: [];
  "set-locale": [string | number | boolean];
  "toggle-notif": [string, boolean];
}>();
</script>

<template>
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
            @update:model-value="(v: string | number | boolean) => emit('set-locale', v)"
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
            @click="emit('save')"
          >
            {{ t("page.settings.s89") }}
          </el-button>
        </div>
      </div>
    </div>

    <NotificationPrefsCard
      :items="notifItems"
      :prefs="notifPrefs"
      :saving="savingNotif"
      @toggle="(k: string, v: boolean) => emit('toggle-notif', k, v)"
    />
  </div>
</template>

<style scoped src="../settings.css"></style>
