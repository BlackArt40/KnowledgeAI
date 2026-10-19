<script setup lang="ts">
// 团队页（V3，复刻 /team）：统计卡 + 成员表（邀请/{{ Object.keys(row.memberRoles ?? {}).length }}/移除，Owner/Admin）
// + 共享 KB 权限面板（access + memberRoles 展示）+ 审计日志（manager 可见）。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  fetchTeam, inviteMember, patchMemberRole, removeMember,
  type TeamData,
} from "@/api/team";
import { fetchCurrentUser } from "@/api/auth";
import { ApiError } from "@/api/client";
import { formatRelative } from "@shared/format";

const { t } = useTranslation();

const data = ref<TeamData | null>(null);
const loading = ref(true);
const me = ref<{ id: string; role: string } | null>(null);
const inviteOpen = ref(false);
const inviteEmail = ref("");
const inviteRole = ref("editor");
const inviteBusy = ref(false);
const inviteError = ref<string | null>(null);
const actionError = ref<string | null>(null);

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};
const ROLES = ["owner", "admin", "editor", "viewer"];

async function refresh() {
  try {
    data.value = await fetchTeam();
  } catch {
    /* ignore */
  }
  loading.value = false;
}

onMounted(async () => {
  const u = await fetchCurrentUser().catch(() => null);
  if (u) me.value = { id: u.id, role: u.role ?? "" };
  await refresh();
});

const canManage = computed(() => me.value && ["owner", "admin"].includes(me.value.role));
const isOwner = computed(() => me.value?.role === "owner");

async function submitInvite() {
  if (!inviteEmail.value.trim()) return;
  inviteBusy.value = true;
  inviteError.value = null;
  try {
    await inviteMember(inviteEmail.value.trim(), inviteRole.value);
    inviteOpen.value = false;
    inviteEmail.value = "";
    await refresh();
  } catch (e) {
    inviteError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s42");
  } finally {
    inviteBusy.value = false;
  }
}

async function changeRole(id: string, role: string) {
  actionError.value = null;
  try {
    await patchMemberRole(id, role);
    await refresh();
  } catch (e) {
    actionError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
  }
}

async function remove(id: string) {
  if (!window.confirm(t("page.team.removeMember"))) return;
  actionError.value = null;
  try {
    await removeMember(id);
    await refresh();
  } catch (e) {
    actionError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
  }
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h2>{{ t("page.team.tabMembers") }}</h2>
        <p class="sub">
          {{ t("page.invite-dialog.s1") }}
        </p>
      </div>
      <el-button
        v-if="canManage"
        type="primary"
        @click="inviteOpen = true; inviteError = null"
      >
        {{ t("page.invite-dialog.s0") }}
      </el-button>
    </div>

    <div
      v-if="loading"
      class="sk"
      style="height: 260px"
    />
    <template v-else-if="data">
      <div class="stats">
        <div class="card stat">
          <span class="v">{{ data.stats.total }}</span><span class="l">{{ t("page.team.member") }}</span>
        </div>
        <div class="card stat">
          <span class="v">{{ data.stats.active }}</span><span class="l">{{ t("page.team.online") }}</span>
        </div>
        <div class="card stat">
          <span class="v">{{ data.stats.invited }}</span><span class="l">{{ t("page.team.invited") }}</span>
        </div>
        <div class="card stat">
          <span class="v">{{ data.stats.owners }}</span><span class="l">Owner</span>
        </div>
      </div>

      <p
        v-if="actionError"
        class="err"
      >
        {{ actionError }}
      </p>

      <div class="card">
        <div class="card-head">
          <h3>{{ t("page.team.tabMembers") }}</h3>
        </div>
        <div class="card-body">
          <div
            v-for="m in data.members"
            :key="m.id"
            class="member"
          >
            <span class="avatar">{{ (m.name || m.email || "?").charAt(0).toUpperCase() }}</span>
            <span class="m-main">
              <span class="m-name">{{ m.name }} <span
                v-if="m.status === 'invited'"
                class="badge warn"
              >{{ t("page.team.invited") }}</span></span>
              <span class="m-email">{{ m.email }}</span>
            </span>
            <template v-if="canManage && m.id !== me?.id">
              <el-select
                :model-value="m.role"
                size="small"
                style="width: 110px"
                :disabled="m.role === 'owner' && !isOwner"
                @update:model-value="(v: string) => changeRole(m.id, v)"
              >
                <el-option
                  v-for="r in ROLES"
                  :key="r"
                  :value="r"
                  :label="ROLE_BADGE[r]"
                />
              </el-select>
              <el-button
                v-if="m.role !== 'owner'"
                size="small"
                text
                type="danger"
                @click="remove(m.id)"
              >
                {{ t("common.delete") }}
              </el-button>
            </template>
            <span
              v-else
              class="badge"
            >{{ ROLE_BADGE[m.role] ?? m.role }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>{{ t("page.team.tabShared") }}</h3>
        </div>
        <div class="card-body">
          <div
            v-if="data.sharedKbs.length === 0"
            class="hint"
            style="padding: 16px 0; text-align: center"
          >
            {{ t("page.team.noAudit") }}
          </div>
          <div
            v-for="row in data.sharedKbs"
            :key="row.kbId"
            class="kb-row"
          >
            <span class="m-main">
              <span class="m-name">{{ row.kbName }}</span>
              <span class="m-email">{{ row.ownerName }} · {{ row.docs }} {{ t("page.document-list.s1") }}</span>
            </span>
            <span class="badge">{{ row.access }}</span>
            <span class="m-email">{{ Object.keys(row.memberRoles ?? {}).length }} {{ Object.keys(row.memberRoles ?? {}).length }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="data.audit.length > 0"
        class="card"
      >
        <div class="card-head">
          <h3>{{ t("page.team.tabAudit") }}</h3>
        </div>
        <div class="card-body history">
          <div
            v-for="a in data.audit"
            :key="a.id"
            class="audit-row"
          >
            <span class="badge">{{ a.action }}</span>
            <span class="audit-main">{{ a.actor }} {{ a.target ? `→ ${a.target}` : "" }}</span>
            <span>{{ formatRelative(a.createdAt) }}</span>
          </div>
        </div>
      </div>
    </template>

    <el-dialog
      v-model="inviteOpen"
      :title="t('page.team.s2')"
      width="400px"
      @closed="inviteError = null"
    >
      <div class="form">
        <label class="field">
          <span class="label">{{ t("page.invite-dialog.s3") }}</span>
          <el-input
            v-model="inviteEmail"
            type="email"
            placeholder="member@company.com"
            required
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.invite-dialog.s4") }}</span>
          <el-select
            v-model="inviteRole"
            style="width: 100%"
          >
            <el-option
              v-for="r in ROLES"
              :key="r"
              :value="r"
              :label="ROLE_BADGE[r]"
            />
          </el-select>
        </label>
        <p
          v-if="inviteError"
          class="err"
        >
          {{ inviteError }}
        </p>
      </div>
      <template #footer>
        <el-button @click="inviteOpen = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          :loading="inviteBusy"
          @click="submitInvite"
        >
          {{ t("page.invite-dialog.s0") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 64rem;
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
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
}
.stat {
  padding: 16px;
  display: grid;
  gap: 2px;
}
.v {
  font-size: 22px;
  font-weight: 700;
}
.l {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.card-head {
  padding: 14px 20px 0;
}
.card-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.card-body {
  padding: 10px 20px 16px;
}
.member {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.member:last-child {
  border-bottom: 0;
}
.avatar {
  display: flex;
  height: 34px;
  width: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.m-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 1px;
}
.m-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
}
.m-email {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.badge.warn {
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
}
.kb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.kb-row:last-child {
  border-bottom: 0;
}
.history {
  max-height: 256px;
  overflow-y: auto;
}
.audit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.audit-main {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
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
