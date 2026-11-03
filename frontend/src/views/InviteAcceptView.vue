<script setup lang="ts">
// 团队邀请接受页：链接来自邮件 / 邀请人转发（/invite?token=...）。
// 需要登录被邀请的账号；接受后成员行变 active、加入邀请人的工作区。
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { acceptTeamInvite, rejectTeamInvite } from "@/api/team";
import { ApiError } from "@/api/client";

const { t } = useTranslation();
const route = useRoute();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));

type State = "idle" | "busy" | "ok" | "rejected" | "error";
const state = ref<State>("idle");
const error = ref("");
const isLoginError = ref(false);

async function run(kind: "accept" | "reject") {
  if (!token.value) {
    state.value = "error";
    error.value = t("page.inviteAccept.missingToken");
    return;
  }
  state.value = "busy";
  error.value = "";
  isLoginError.value = false;
  try {
    await (kind === "accept" ? acceptTeamInvite(token.value) : rejectTeamInvite(token.value));
    state.value = kind === "accept" ? "ok" : "rejected";
  } catch (e) {
    state.value = "error";
    if (e instanceof ApiError && e.status === 401) {
      isLoginError.value = true;
      error.value = t("page.inviteAccept.loginFirst");
    } else {
      error.value = e instanceof ApiError && e.message ? e.message : t("page.inviteAccept.error");
    }
  }
}
</script>

<template>
  <main class="wrap">
    <div class="card invite">
      <h1>{{ t("page.inviteAccept.title") }}</h1>
      <p class="hint">
        {{ t("page.inviteAccept.hint") }}
      </p>

      <p
        v-if="state === 'ok'"
        class="ok"
      >
        {{ t("page.inviteAccept.success") }}
      </p>
      <p
        v-else-if="state === 'rejected'"
        class="hint"
      >
        {{ t("page.inviteAccept.rejected") }}
      </p>
      <p
        v-else-if="error"
        class="err"
      >
        {{ error }}
      </p>

      <div
        v-if="state === 'idle' || state === 'busy'"
        class="actions"
      >
        <el-button
          type="primary"
          :loading="state === 'busy'"
          @click="run('accept')"
        >
          {{ t("page.inviteAccept.accept") }}
        </el-button>
        <el-button
          :disabled="state === 'busy'"
          @click="run('reject')"
        >
          {{ t("page.inviteAccept.reject") }}
        </el-button>
      </div>

      <div
        v-else
        class="actions"
      >
        <RouterLink
          v-if="state === 'ok'"
          to="/team"
        >
          {{ t("page.inviteAccept.goTeam") }}
        </RouterLink>
        <RouterLink
          v-else-if="isLoginError"
          to="/login"
        >
          {{ t("page.login.s1") }}
        </RouterLink>
        <RouterLink
          v-else
          to="/team"
        >
          {{ t("page.inviteAccept.goTeam") }}
        </RouterLink>
      </div>
    </div>
  </main>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.invite {
  width: min(440px, 100%);
  padding: 28px;
  display: grid;
  gap: 14px;
}
.invite h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.ok {
  color: hsl(var(--positive));
  margin: 0;
}
.err {
  color: hsl(var(--destructive));
  margin: 0;
}
</style>
