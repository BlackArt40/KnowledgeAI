<script setup lang="ts">
// 团队页（V3）：统计卡 + 成员表（邀请/改角色/移除）+ 共享 KB 权限编辑
// + 成员级授权 + 权限矩阵 + 审计日志。
// 角色能力来自后端 /api/team（permissions / matrix），前端不再硬编码角色。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Check, CircleCheck, Message, Star, User } from "@element-plus/icons-vue";
import {
  downloadTeamActivityCsv,
  fetchTeam,
  fetchTeamActivity,
  inviteMember,
  patchMemberRole,
  removeMember,
  patchKbAccess,
  setKbMemberRole,
  type ActivityCategory,
  type SharedKbRow,
  type TeamActivityItem,
  type TeamData,
  type TeamMember,
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
const inviteLink = ref("");
const actionError = ref<string | null>(null);
const roleDialogRow = ref<SharedKbRow | null>(null);
const roleError = ref<string | null>(null);

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};
const ROLES = ["owner", "admin", "editor", "viewer"];
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, editor: 2, viewer: 3 };
const ACCESS_LEVELS = ["view", "edit", "private"];
/** 能力矩阵的行顺序；能力名与后端 Permission 字面量一一对应。 */
const CAPS: { key: string; label: string }[] = [
  { key: "kb.read", label: "page.team.capKbRead" },
  { key: "kb.create", label: "page.team.capKbCreate" },
  { key: "kb.edit", label: "page.team.capKbEdit" },
  { key: "kb.delete", label: "page.team.capKbDelete" },
  { key: "chat.use", label: "page.team.capChatUse" },
  { key: "agent.run", label: "page.team.capAgentRun" },
  { key: "member.invite", label: "page.team.capMemberInvite" },
  { key: "member.manage", label: "page.team.capMemberManage" },
  { key: "team.settings", label: "page.team.capTeamSettings" },
  { key: "billing.manage", label: "page.team.capBillingManage" },
];

/** 共享访问级别 → 可读文案（后端存的是 view/edit/private） */
function accessLabel(access: string): string {
  const map: Record<string, string> = {
    view: "page.team.everyoneRead",
    edit: "page.team.memberEditable",
    private: "page.team.onlyOwnerAdmin",
  };
  return map[access] ? t(map[access]) : access;
}

const permissions = computed(() => data.value?.permissions ?? []);
const canManage = computed(() => permissions.value.includes("member.manage"));
const canInvite = computed(() => permissions.value.includes("member.invite"));
const myRank = computed(() => ROLE_RANK[me.value?.role ?? ""] ?? 99);
/** 只能管理严格低于自己的角色：同级/上级（含 Owner）不可动。 */
function canManageTarget(m: TeamMember): boolean {
  if (!canManage.value || m.id === me.value?.id) return false;
  return myRank.value < (ROLE_RANK[m.role] ?? 99);
}
/** 只能授予严格低于自己的角色（Owner 不在可授予范围内）。 */
const assignableRoles = computed(() =>
  ROLES.filter((r) => r !== "owner" && (ROLE_RANK[r] ?? 99) > myRank.value)
);
const roleDialogMembers = computed(() =>
  (data.value?.members ?? []).filter((m) => m.role !== "owner")
);
const roleDialogOpen = computed({
  get: () => roleDialogRow.value !== null,
  set: (open: boolean) => {
    if (!open) {
      roleDialogRow.value = null;
      roleError.value = null;
    }
  },
});

/** 管理者可改任意共享库；KB 所有者可改自己的库（后端同口径）。 */
function canEditKbAccess(row: SharedKbRow): boolean {
  return canManage.value || row.isOwner;
}

async function refresh() {
  try {
    data.value = await fetchTeam();
    if (roleDialogRow.value) {
      const kbId = roleDialogRow.value.kbId;
      roleDialogRow.value = data.value.sharedKbs.find((r) => r.kbId === kbId) ?? null;
    }
  } catch {
    /* ignore */
  }
  loading.value = false;
  if (canManage.value) void loadActivity();
}

// ── 团队活动流（可观测与通知） ────────────────────────────────────────────
const ACTIVITY_FILTERS: { key: "all" | ActivityCategory; label: string }[] = [
  { key: "all", label: "page.team.catAll" },
  { key: "member", label: "page.team.catMember" },
  { key: "permission", label: "page.team.catPermission" },
  { key: "share", label: "page.team.catShare" },
  { key: "content", label: "page.team.catContent" },
  { key: "team", label: "page.team.catTeam" },
  { key: "security", label: "page.team.catSecurity" },
];

const ACTIVITY_ACTION_KEYS: Record<string, string> = {
  "kb.access_change": "page.team.actKbAccess",
  "doc.access_change": "page.team.actDocAccess",
  "sharelink.create": "page.team.actShareCreate",
  "sharelink.revoke": "page.team.actShareRevoke",
  "doc.delete": "page.team.actDocDelete",
};

const activity = ref<TeamActivityItem[]>([]);
const activityCategory = ref<"all" | ActivityCategory>("all");
const activityQuery = ref("");
const activityCounts = ref<Record<ActivityCategory, number>>({
  member: 0, permission: 0, share: 0, content: 0, team: 0, security: 0,
});
const activityTotal = ref(0);
const activityCursor = ref<number | undefined>();
const activityLoading = ref(false);
const activityError = ref<string | null>(null);
const exportingActivity = ref(false);
let activitySeq = 0;

const activityAllCount = computed(() =>
  Object.values(activityCounts.value).reduce((sum, n) => sum + n, 0)
);

function activityAction(item: TeamActivityItem): string {
  const key = ACTIVITY_ACTION_KEYS[item.action];
  return key ? t(key) : item.action;
}

async function loadActivity(reset = true) {
  const seq = ++activitySeq;
  if (reset) activityLoading.value = true;
  activityError.value = null;
  try {
    const page = await fetchTeamActivity({
      category: activityCategory.value,
      q: activityQuery.value,
      limit: 20,
      before: reset ? undefined : activityCursor.value,
    });
    if (seq !== activitySeq) return;
    activity.value = reset ? page.items : [...activity.value, ...page.items];
    activityCounts.value = page.counts;
    activityTotal.value = page.total;
    activityCursor.value = page.nextCursor;
  } catch {
    if (seq === activitySeq) activityError.value = t("page.team.activityLoadFailed");
  } finally {
    if (seq === activitySeq) activityLoading.value = false;
  }
}

function selectActivityCategory(key: "all" | ActivityCategory) {
  if (activityCategory.value === key) return;
  activityCategory.value = key;
  void loadActivity();
}

async function exportActivity() {
  exportingActivity.value = true;
  activityError.value = null;
  try {
    await downloadTeamActivityCsv({
      category: activityCategory.value,
      q: activityQuery.value,
    });
  } catch {
    activityError.value = t("page.team.activityLoadFailed");
  } finally {
    exportingActivity.value = false;
  }
}

onMounted(async () => {
  const u = await fetchCurrentUser().catch(() => null);
  if (u) me.value = { id: u.id, role: u.role ?? "" };
  await refresh();
});

function openInvite() {
  inviteError.value = null;
  inviteLink.value = "";
  inviteRole.value = assignableRoles.value.includes("editor")
    ? "editor"
    : assignableRoles.value[0] ?? "viewer";
  inviteOpen.value = true;
}

async function submitInvite() {
  if (!inviteEmail.value.trim()) return;
  inviteBusy.value = true;
  inviteError.value = null;
  try {
    const res = await inviteMember(inviteEmail.value.trim(), inviteRole.value);
    await refresh();
    if (res?.inviteUrl) {
      // 演示模式未配置邮件发送：把邀请链接直接给邀请人。
      inviteLink.value = res.inviteUrl;
      inviteEmail.value = "";
    } else {
      inviteOpen.value = false;
      inviteEmail.value = "";
    }
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
    await refresh();
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

async function changeKbAccess(row: SharedKbRow, access: string) {
  if (access === row.access) return;
  actionError.value = null;
  try {
    await patchKbAccess(row.kbId, access);
    await refresh();
  } catch (e) {
    actionError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
    await refresh();
  }
}

function openRoleDialog(row: SharedKbRow) {
  roleError.value = null;
  roleDialogRow.value = row;
}

async function changeMemberRole(email: string, value: string) {
  const row = roleDialogRow.value;
  if (!row || (row.memberRoles?.[email] ?? "") === value) return;
  roleError.value = null;
  try {
    await setKbMemberRole(row.kbId, email, value === "" ? null : value);
    await refresh();
  } catch (e) {
    roleError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
    await refresh();
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
        v-if="canInvite"
        type="primary"
        @click="openInvite"
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
          <span class="stat-icon"><el-icon :size="16"><User /></el-icon></span>
          <span class="v">{{ data.stats.total }}</span><span class="l">{{ t("page.team.member") }}</span>
        </div>
        <div class="card stat">
          <span class="stat-icon"><el-icon :size="16"><CircleCheck /></el-icon></span>
          <span class="v">{{ data.stats.active }}</span><span class="l">{{ t("page.team.online") }}</span>
        </div>
        <div class="card stat">
          <span class="stat-icon"><el-icon :size="16"><Message /></el-icon></span>
          <span class="v">{{ data.stats.invited }}</span><span class="l">{{ t("page.team.invited") }}</span>
        </div>
        <div class="card stat">
          <span class="stat-icon"><el-icon :size="16"><Star /></el-icon></span>
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
              <span class="m-name">
                {{ m.name }}
                <span
                  v-if="m.id === me?.id"
                  class="m-email"
                >{{ t("page.team.selfMarker") }}</span>
                <span
                  v-if="m.status === 'invited'"
                  class="badge warn"
                >{{ t("page.team.invited") }}</span>
              </span>
              <span class="m-email">{{ m.email }}</span>
            </span>
            <template v-if="canManageTarget(m)">
              <el-select
                :model-value="m.role"
                size="small"
                style="width: 110px"
                :aria-label="`${m.name || m.email} ${t('page.team.role')}`"
                @update:model-value="(v: string) => changeRole(m.id, v)"
              >
                <el-option
                  v-for="r in assignableRoles"
                  :key="r"
                  :value="r"
                  :label="ROLE_BADGE[r]"
                />
              </el-select>
              <el-button
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
              <span class="m-name">
                {{ row.kbName }}
                <span
                  v-if="row.isOwner"
                  class="badge"
                >{{ t("page.team.mineMarker") }}</span>
              </span>
              <span class="m-email">{{ row.ownerName }} · {{ row.docs }} {{ t("page.document-list.s1") }}</span>
            </span>
            <el-select
              v-if="canEditKbAccess(row)"
              :model-value="row.access"
              size="small"
              style="width: 140px"
              :aria-label="`${row.kbName} ${t('page.team.setSharedAccess')}`"
              @update:model-value="(v: string) => changeKbAccess(row, v)"
            >
              <el-option
                v-for="a in ACCESS_LEVELS"
                :key="a"
                :value="a"
                :label="accessLabel(a)"
              />
            </el-select>
            <span
              v-else
              class="badge"
            >{{ accessLabel(row.access) }}</span>
            <el-button
              v-if="row.isOwner"
              size="small"
              text
              @click="openRoleDialog(row)"
            >
              {{ t("page.team.memberPermLabel") }}
            </el-button>
            <span
              v-else
              class="m-email"
            >{{ t("page.team.s28", { count: row.memberRoleCount }) }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>{{ t("page.team.tabMatrix") }}</h3>
          <p class="sub matrix-hint">
            {{ t("page.team.matrixHint") }}
          </p>
        </div>
        <div class="card-body">
          <div class="matrix">
            <div class="matrix-row matrix-head">
              <span class="matrix-cap">{{ t("page.team.capability") }}</span>
              <span
                v-for="r in ROLES"
                :key="r"
                class="matrix-role"
              >{{ ROLE_BADGE[r] }}</span>
            </div>
            <div
              v-for="cap in CAPS"
              :key="cap.key"
              class="matrix-row"
            >
              <span class="matrix-cap">{{ t(cap.label) }}</span>
              <span
                v-for="r in ROLES"
                :key="r"
                class="matrix-cell"
              >
                <el-icon
                  v-if="data.matrix?.[r]?.includes(cap.key)"
                  class="matrix-yes"
                >
                  <Check />
                </el-icon>
                <span
                  v-else
                  class="matrix-no"
                >—</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="canManage"
        class="card"
      >
        <div class="card-head between">
          <div>
            <h3>{{ t("page.team.activityTitle") }}</h3>
            <p class="sub activity-hint">
              {{ t("page.team.activityHint") }}
            </p>
          </div>
          <el-button
            size="small"
            :loading="exportingActivity"
            @click="exportActivity"
          >
            {{ t("page.team.exportCsv") }}
          </el-button>
        </div>
        <div class="card-body">
          <div class="activity-filters">
            <button
              v-for="c in ACTIVITY_FILTERS"
              :key="c.key"
              type="button"
              class="activity-chip"
              :class="{ active: activityCategory === c.key }"
              @click="selectActivityCategory(c.key)"
            >
              {{ t(c.label) }}
              <span class="activity-chip-count">
                {{ c.key === "all" ? activityAllCount : activityCounts[c.key] }}
              </span>
            </button>
            <el-input
              v-model="activityQuery"
              class="activity-search"
              size="small"
              clearable
              :placeholder="t('page.team.activitySearch')"
              @keyup.enter="loadActivity()"
              @clear="loadActivity()"
            />
          </div>

          <p
            v-if="activityError"
            class="err"
          >
            {{ activityError }}
          </p>

          <div
            v-if="activityLoading && activity.length === 0"
            class="sk"
            style="height: 120px"
          />
          <div
            v-else-if="activity.length === 0"
            class="hint activity-empty"
          >
            {{ t("page.team.noAudit") }}
          </div>
          <div
            v-else
            class="activity-list kai-scroll"
          >
            <div
              v-for="a in activity"
              :key="a.id"
              class="activity-row"
            >
              <span class="badge activity-badge">{{ t(`page.team.cat${a.category.charAt(0).toUpperCase() + a.category.slice(1)}`) }}</span>
              <span class="activity-main">
                <span class="activity-line">
                  <strong>{{ a.actor }}</strong>
                  <span v-if="a.target"> → {{ a.target }}</span>
                </span>
                <span class="activity-detail">
                  {{ activityAction(a) }}<template v-if="a.detail"> · {{ a.detail }}</template>
                </span>
              </span>
              <span class="activity-time">{{ formatRelative(a.createdAt) }}</span>
            </div>
          </div>

          <div
            v-if="activity.length < activityTotal"
            class="activity-more"
          >
            <el-button
              size="small"
              text
              :loading="activityLoading"
              @click="loadActivity(false)"
            >
              {{ t("page.team.loadMore") }}
            </el-button>
          </div>
        </div>
      </div>
    </template>

    <el-dialog
      v-model="roleDialogOpen"
      :title="t('page.team.setSharedAccess')"
      width="460px"
    >
      <p class="hint">
        {{ t("page.team.memberRoleHint") }}
      </p>
      <div
        v-for="m in roleDialogMembers"
        :key="m.id"
        class="member"
      >
        <span class="avatar">{{ (m.name || m.email || "?").charAt(0).toUpperCase() }}</span>
        <span class="m-main">
          <span class="m-name">{{ m.name }}</span>
          <span class="m-email">{{ m.email }}</span>
        </span>
        <el-select
          :model-value="roleDialogRow?.memberRoles?.[m.email] ?? ''"
          size="small"
          style="width: 140px"
          :aria-label="`${m.name || m.email} ${t('page.team.memberPermLabel')}`"
          @update:model-value="(v: string) => changeMemberRole(m.email, v)"
        >
          <el-option
            value=""
            :label="t('page.team.inherit')"
          />
          <el-option
            value="editor"
            label="Editor"
          />
          <el-option
            value="viewer"
            label="Viewer"
          />
        </el-select>
      </div>
      <p
        v-if="roleError"
        class="err"
      >
        {{ roleError }}
      </p>
    </el-dialog>

    <el-dialog
      v-model="inviteOpen"
      :title="t('page.invite-dialog.s0')"
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
              v-for="r in assignableRoles"
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
        <label
          v-if="inviteLink"
          class="field"
        >
          <span class="label">{{ t("page.team.inviteLinkHint") }}</span>
          <el-input
            :model-value="inviteLink"
            readonly
            size="small"
          />
        </label>
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
.wrap > * {
  min-width: 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (min-width: 640px) {
  .stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.stat {
  padding: 16px 18px;
  display: grid;
  gap: 2px;
}
.stat-icon {
  display: inline-flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  border-radius: 9px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
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
  border-radius: var(--radius-full);
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
.badge { padding: 2px 8px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

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
.activity-hint { margin: 4px 0 0; }
.activity-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.activity-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-full);
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  cursor: pointer;
}
.activity-chip:hover { background: hsl(var(--muted)); }
.activity-chip.active {
  border-color: hsl(var(--primary) / 0.35);
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.activity-chip-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.activity-search { width: 200px; margin-left: auto; }
.activity-list {
  max-height: 320px;
  overflow-y: auto;
}
.activity-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid hsl(var(--border));
  font-size: 12px;
}
.activity-row:last-child { border-bottom: 0; }
.activity-badge { flex-shrink: 0; }
.activity-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.activity-line {
  color: hsl(var(--foreground));
  font-size: 13px;
}
.activity-detail {
  color: hsl(var(--muted-foreground));
  overflow-wrap: anywhere;
}
.activity-time {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}
.activity-more {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}
.activity-empty { padding: 16px 0; text-align: center; }
@media (max-width: 640px) {
  .activity-search { width: 100%; margin-left: 0; }
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
.hint { font-size: 13px; }
.matrix-hint { margin: 4px 0 0; }

.matrix {
  display: grid;
  gap: 2px;
}
.matrix-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) repeat(4, minmax(56px, 72px));
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.matrix-row:last-child {
  border-bottom: 0;
}
.matrix-head {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
}
.matrix-cap {
  font-size: 13px;
}
.matrix-role,
.matrix-cell {
  text-align: center;
}
.matrix-yes {
  color: hsl(var(--primary));
}
.matrix-no {
  color: hsl(var(--muted-foreground));
}

.err {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}
</style>
