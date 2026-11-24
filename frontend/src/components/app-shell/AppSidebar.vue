<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { ArrowDown, Check, Star } from "@element-plus/icons-vue";
import AppLogo from "@/components/AppLogo.vue";
import { createWorkspace, switchTo } from "@/api/workspaces";

import { planLabelKey } from "@/lib/plan";

type Role = "owner" | "admin" | "editor" | "viewer";
interface NavItem { labelKey: string; href: string; icon: object; roles?: Role[] }
interface NavGroup { titleKey: string; items: NavItem[] }

const props = defineProps<{
  groups: NavGroup[];
  currentName: string;
  workspaces: { id: string; name: string; plan: string; active?: boolean }[];
  onFreePlan: boolean;
  mobileOpen: boolean;
}>();
const emit = defineEmits<{ "update:mobileOpen": [boolean] }>();
const route = useRoute();
const { t } = useTranslation();
const creating = ref(false);
const wsOpen = ref(false);
const newName = ref("");

const drawerOpen = computed({
  get: () => props.mobileOpen,
  set: (v: boolean) => emit("update:mobileOpen", v),
});
function closeMobile() { emit("update:mobileOpen", false); }
function planText(plan: string): string {
  const key = planLabelKey(plan);
  return key ? t(key) : plan;
}
async function createWs() {
  if (!newName.value.trim()) return;
  try {
    const d = await createWorkspace(newName.value.trim());
    if (d.workspace?.id) switchTo(d.workspace.id);
  } catch { /* ignore */ }
}
</script>

<template>
  <aside class="sidebar hidden lg:block">
    <div class="side-head">
      <AppLogo />
    </div>
    <div class="ws-box">
      <el-popover
        v-model:visible="wsOpen"
        placement="bottom-start"
        :width="230"
        trigger="click"
      >
        <template #reference>
          <button
            class="ws-btn"
            type="button"
          >
            <span class="ws-avatar">{{ (currentName || "W").charAt(0) }}</span>
            <span class="ws-name">{{ currentName || t("page.app-shell.s5") }}</span>
            <el-icon :size="12">
              <ArrowDown />
            </el-icon>
          </button>
        </template>
        <div class="ws-menu">
          <button
            v-for="w in workspaces"
            :key="w.id"
            type="button"
            class="ws-item"
            :class="{ active: w.active }"
            @click="switchTo(w.id)"
          >
            <span class="ws-item-name">{{ w.name }}</span>
            <el-icon
              v-if="w.active"
              :size="12"
            >
              <Check />
            </el-icon>
            <span
              class="ws-plan"
              :class="{ pro: w.plan !== 'free' }"
            >{{ planText(w.plan) }}</span>
          </button>
          <div class="ws-create">
            <template v-if="creating">
              <input
                v-model="newName"
                class="ws-input"
                :placeholder="t('page.app-shell.s18')"
                @keydown.enter="createWs"
              >
              <el-button
                size="small"
                type="primary"
                @click="createWs"
              >
                {{ t("common.create") }}
              </el-button>
            </template>
            <button
              v-else
              type="button"
              class="ws-add"
              @click="creating = true"
            >
              {{ t("page.app-shell.s30") }}
            </button>
          </div>
        </div>
      </el-popover>
    </div>

    <nav class="nav kai-scroll">
      <div
        v-for="g in groups"
        :key="g.titleKey"
        class="nav-group"
      >
        <p class="nav-title">
          {{ t(g.titleKey) }}
        </p>
        <template
          v-for="item in g.items"
          :key="item.href"
        >
          <router-link
            :to="item.href"
            class="nav-item"
            :class="{ active: route.path === item.href }"
          >
            <el-icon :size="16">
              <component :is="item.icon" />
            </el-icon>
            <span>{{ t(item.labelKey) }}</span>
          </router-link>
        </template>
      </div>
    </nav>

    <div
      v-if="onFreePlan"
      class="upgrade"
    >
      <div class="upgrade-head">
        <el-icon
          :size="14"
          color="hsl(var(--primary))"
        >
          <Star />
        </el-icon>
        <span>{{ t("page.app-shell.s0") }}</span>
      </div>
      <p class="upgrade-desc">
        {{ t("page.app-shell.s31") }}
      </p>
      <router-link
        to="/checkout?plan=pro"
        class="upgrade-btn"
      >
        {{ t("page.app-shell.s32") }}
      </router-link>
    </div>
  </aside>

  <!-- 移动端抽屉 -->
  <el-drawer
    :model-value="drawerOpen"
    direction="ltr"
    size="280px"
    :title="t('page.app-shell.s1')"
    class="mobile-drawer"
    @update:model-value="emit('update:mobileOpen', $event)"
  >
    <nav class="nav kai-scroll">
      <div
        v-for="g in groups"
        :key="g.titleKey"
        class="nav-group"
      >
        <p class="nav-title">
          {{ t(g.titleKey) }}
        </p>
        <template
          v-for="item in g.items"
          :key="item.href"
        >
          <router-link
            :to="item.href"
            class="nav-item"
            @click="closeMobile"
          >
            <el-icon :size="16">
              <component :is="item.icon" />
            </el-icon>
            <span>{{ t(item.labelKey) }}</span>
          </router-link>
        </template>
      </div>
    </nav>
  </el-drawer>
</template>

<style scoped src="./app-shell.css"></style>
