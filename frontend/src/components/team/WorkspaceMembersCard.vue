<script setup lang="ts">
// 当前工作区成员（多租户）：与团队全局成员分开管理。
// 组件自管数据：TeamView 只负责组合，不再同时承载两套成员逻辑。
import { onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  addWorkspaceMember,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  type WorkspaceMembersData,
} from "@/api/workspaces";
import { errorMessage } from "@/api/client";

defineProps<{ meEmail?: string }>();

const { t } = useTranslation();
const data = ref<WorkspaceMembersData | null>(null);
const email = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function load() {
  try {
    data.value = await fetchWorkspaceMembers();
  } catch {
    data.value = null;
  }
}

async function add() {
  const value = email.value.trim();
  if (!value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await addWorkspaceMember(value);
    email.value = "";
    await load();
  } catch (e) {
    error.value = errorMessage(e, t("page.team.workspaceMemberError"));
  } finally {
    busy.value = false;
  }
}

async function remove(target: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await removeWorkspaceMember(target);
    await load();
  } catch (e) {
    error.value = errorMessage(e, t("page.team.workspaceMemberError"));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div
    v-if="data"
    class="card"
  >
    <div class="card-head between">
      <h3>{{ t("page.team.workspaceMembers") }}</h3>
      <span class="hint">{{ data.workspace.name }} · {{ data.workspace.plan }}</span>
    </div>
    <div class="card-body">
      <p class="sub">
        {{ t("page.team.workspaceMembersHint") }}
      </p>
      <div
        v-for="m in data.members"
        :key="m.email"
        class="ws-row"
      >
        <span class="ws-avatar">{{ (m.name || m.email).charAt(0).toUpperCase() }}</span>
        <span class="ws-main">
          <span class="ws-name">{{ m.name }}</span>
          <span class="ws-email">{{ m.email }}</span>
        </span>
        <el-button
          v-if="data.canManage && m.email !== meEmail"
          size="small"
          text
          type="danger"
          :disabled="busy"
          @click="remove(m.email)"
        >
          {{ t("page.team.removeWorkspaceMember") }}
        </el-button>
      </div>
      <div
        v-if="data.canManage"
        class="ws-add"
      >
        <el-input
          v-model="email"
          size="small"
          :placeholder="t('page.team.workspaceMemberEmail')"
        />
        <el-button
          size="small"
          type="primary"
          :loading="busy"
          :disabled="!email.trim()"
          @click="add"
        >
          {{ t("page.team.addWorkspaceMember") }}
        </el-button>
      </div>
      <p
        v-if="error"
        class="err"
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ws-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.ws-row:last-of-type {
  border-bottom: none;
}
.ws-avatar {
  display: inline-flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
  font-size: 12px;
  font-weight: 600;
}
.ws-main {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.ws-name {
  font-size: 13px;
  font-weight: 500;
}
.ws-email {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.ws-add {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
