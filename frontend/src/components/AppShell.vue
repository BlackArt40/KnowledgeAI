<script setup lang="ts">
// AppShell（V2，复刻 src/components/app/app-shell.tsx）：
// 桌面侧栏 + 移动端抽屉 + 顶栏（标题/搜索/通知/语言/主题/用户菜单）。
// 导航路由区分已接管（router-link）与未迁移（<a> 整页跳转，跨壳纪律）。
// 401 → /login；网络失败保留壳（离线策略）；Cmd/Ctrl+K 开全局搜索。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import {
  BellFilled, Check, Finished, ArrowDown, Notebook, WalletFilled, TrendCharts, Compass, Key,
  Odometer, Collection, SwitchButton, Menu, ChatDotRound, MagicStick, Search,
  Setting, CircleCheck, Star, User,
} from "@element-plus/icons-vue";
import { getI18nInstance } from "@shared/i18n/translate";
import AppLogo from "@/components/AppLogo.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";
import GlobalSearch from "@/components/GlobalSearch.vue";
import { fetchCurrentUser } from "@/api/auth";
import { ApiError, api } from "@/api/client";
import {
  createWorkspace, fetchWorkspaces, switchTo,
  type Workspace,
} from "@/api/workspaces";
import {
  fetchNotifications, markAllRead, markOneRead,
  type Notification,
} from "@/api/notifications";
import { formatRelative } from "@shared/format";

type Role = "owner" | "admin" | "editor" | "viewer";

interface NavItem {
  labelKey: string;
  href: string;
  icon: object;
  roles?: Role[];
  /** V2 起已由 Vue 接管的路由用 router-link，其余整页跳转回 Next */
  migrated?: boolean;
}

// 角色导航（与 RBAC 矩阵对齐，路径/角色/文案 key 与 Next 版逐字一致）
const navGroups: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "page.app-shell.s5",
    items: [
      { labelKey: "page.app-shell.s6", href: "/dashboard", icon: Odometer, migrated: true },
      { labelKey: "page.app-shell.s7", href: "/knowledge-base", icon: Collection, migrated: true },
      { labelKey: "page.app-shell.s8", href: "/chat", icon: ChatDotRound, migrated: true },
      { labelKey: "page.app-shell.s9", href: "/agent", icon: MagicStick, roles: ["owner", "admin", "editor"], migrated: true },
    ],
  },
  {
    titleKey: "page.app-shell.s10",
    items: [
      { labelKey: "page.app-shell.s11", href: "/team", icon: User, migrated: true },
      { labelKey: "page.app-shell.s12", href: "/billing", icon: WalletFilled, roles: ["owner", "admin"], migrated: true },
      { labelKey: "page.app-shell.s13", href: "/usage", icon: TrendCharts, roles: ["owner", "admin", "editor"], migrated: true },
    ],
  },
  {
    titleKey: "page.app-shell.s14",
    items: [
      { labelKey: "page.app-shell.s15", href: "/api-keys", icon: Key, roles: ["owner", "admin", "editor"], migrated: true },
      { labelKey: "page.app-shell.s28", href: "/developer", icon: Notebook, roles: ["owner", "admin", "editor"], migrated: true },
      { labelKey: "page.app-shell.s16", href: "/settings", icon: Setting, migrated: true },
      { labelKey: "page.app-shell.s17", href: "/admin", icon: CircleCheck, roles: ["owner", "admin"], migrated: true },
      // P6-1 可观测看板（owner/admin）
      { labelKey: "page.app-shell.s27", href: "/admin/monitoring", icon: TrendCharts, roles: ["owner", "admin"], migrated: true },
    ],
  },
];

// 顶栏标题：与 Next app-shell.tsx 的 titleMap 逐字一致（未列出的路径回退通用标题）
const titleMap: Record<string, string> = {
  "/dashboard": "page.app-shell.s6",
  "/knowledge-base": "page.app-shell.s7",
  "/chat": "page.app-shell.s8",
  "/agent": "page.app-shell.s9",
  "/team": "page.app-shell.s11",
  "/billing": "page.app-shell.s12",
  "/usage": "page.app-shell.s13",
  "/api-keys": "page.app-shell.s15",
  "/developer": "page.app-shell.s28",
  "/settings": "page.app-shell.s16",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  plan?: string;
}

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const i18n = getI18nInstance();

const user = ref<CurrentUser | null>(null);
const mobileOpen = ref(false);
const searchOpen = ref(false);
const notifOpen = ref(false);
const userMenuOpen = ref(false);
const langOpen = ref(false);
const notifs = ref<Notification[]>([]);
const unread = ref(0);
const workspaces = ref<Workspace[]>([]);
const currentName = ref("");
const wsOpen = ref(false);
const creating = ref(false);
const newName = ref("");

const title = computed(() => {
  const key = titleMap[String(route.path)];
  return key ? t(key) : t("page.app-shell.s20");
});
const locale = computed(() => i18n.language === "en" ? "en" : "zh-CN");

// 路由守卫（与 Next 版 RESTRICTED 一致），未授权跳 /dashboard
function routeGuard(role: string | undefined, path: string): boolean {
  const RESTRICTED: Record<string, Role[]> = {
    "/admin": ["owner", "admin"],
    "/billing": ["owner", "admin"],
    "/agent": ["owner", "admin", "editor"],
    "/usage": ["owner", "admin", "editor"],
    "/api-keys": ["owner", "admin", "editor"],
    "/developer": ["owner", "admin", "editor"],
  };
  for (const [prefix, roles] of Object.entries(RESTRICTED)) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      if (!role || !roles.includes(role as Role)) return false;
    }
  }
  return true;
}

let notifTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  // 仅 401 跳登录；网络失败保留壳（离线策略）
  try {
    const u = await fetchCurrentUser().catch((e) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    });
    if (u) {
      user.value = {
        id: u.id,
        name: u.name ?? "",
        email: u.email,
        role: u.role ?? "",
        plan: (u as { plan?: string }).plan,
      };
      if (!routeGuard(user.value?.role, route.path)) await router.replace("/dashboard");
    }
  } catch {
    /* offline: keep shell */
  }
  void refreshNotifs();
  notifTimer = setInterval(() => void refreshNotifs(), 30_000);
  void loadWorkspaces();
});

onBeforeUnmount(() => {
  if (notifTimer) clearInterval(notifTimer);
});

async function refreshNotifs() {
  try {
    const d = await fetchNotifications(10);
    notifs.value = d.notifications ?? [];
    unread.value = d.unread ?? 0;
  } catch {
    /* ignore */
  }
}

async function loadWorkspaces() {
  try {
    const d = await fetchWorkspaces();
    workspaces.value = d.workspaces ?? [];
    currentName.value = d.currentName ?? "";
  } catch {
    /* ignore */
  }
}

async function createWs() {
  if (!newName.value.trim()) return;
  try {
    const d = await createWorkspace(newName.value.trim());
    if (d.workspace?.id) switchTo(d.workspace.id);
  } catch {
    /* ignore */
  }
}

async function logout() {
  userMenuOpen.value = false;
  try {
    await api.post("/api/auth/logout");
  } catch {
    /* offline: leave anyway */
  }
  window.location.href = "/login";
}

async function doMarkAllRead() {
  unread.value = 0;
  notifs.value = notifs.value.map((n) => ({ ...n, read: true }));
  try {
    await markAllRead();
  } catch {
    /* ignore */
  }
}

async function doMarkOneRead(id: string) {
  notifs.value = notifs.value.map((n) => (n.id === id ? { ...n, read: true } : n));
  unread.value = Math.max(0, unread.value - 1);
  try {
    await markOneRead(id);
  } catch {
    /* ignore */
  }
}

function openNotif(n: Notification) {
  if (!n.read) void doMarkOneRead(n.id);
  if (n.link) {
    notifOpen.value = false;
    window.location.href = n.link; // link 指向的页面可能仍在 Next 侧，整页跳
  }
}

function setLocale(l: string) {
  void i18n.changeLanguage(l);
  try {
    localStorage.setItem("kai-locale", l);
  } catch {
    /* ignore */
  }
  document.cookie = `kai-locale=${l}; path=/; max-age=31536000`;
  document.documentElement.lang = l === "en" ? "en" : "zh-CN";
  langOpen.value = false;
}

function onHotkey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    searchOpen.value = true;
  }
}

/** 用户菜单命令：settings 已由 Vue 接管（router 跳转），logout 走服务端注销。 */
function onUserCommand(c: string | number | object) {
  const cmd = String(c);
  if (cmd === "logout") {
    void logout();
    return;
  }
  userMenuOpen.value = false;
  void router.push(cmd);
}

onMounted(() => window.addEventListener("keydown", onHotkey));
onBeforeUnmount(() => window.removeEventListener("keydown", onHotkey));

const NOTIF_ICON: Record<string, object> = {
  kbReady: Collection, agentDone: MagicStick, securityAlert: BellFilled, emailDigest: BellFilled,
};

function canSee(item: NavItem): boolean {
  return !item.roles || (!!user.value && item.roles.includes(user.value.role as Role));
}

const visibleGroups = computed(() =>
  navGroups
    .map((g) => ({ ...g, items: g.items.filter(canSee) }))
    .filter((g) => g.items.length > 0)
);
</script>

<template>
  <div class="shell">
    <GlobalSearch v-model:open="searchOpen" />

    <!-- 桌面侧栏 -->
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
              <span class="ws-plan">{{ w.plan }}</span>
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

      <nav class="nav">
        <div
          v-for="g in visibleGroups"
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
              v-if="item.migrated"
              :to="item.href"
              class="nav-item"
              :class="{ active: route.path === item.href }"
            >
              <el-icon :size="16">
                <component :is="item.icon" />
              </el-icon>
              <span>{{ t(item.labelKey) }}</span>
            </router-link>
            <a
              v-else
              :href="item.href"
              class="nav-item"
            >
              <el-icon :size="16"><component :is="item.icon" /></el-icon>
              <span>{{ t(item.labelKey) }}</span>
            </a>
          </template>
        </div>
      </nav>

      <div
        v-if="!user?.plan || user.plan === 'free'"
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
      v-model="mobileOpen"
      direction="ltr"
      size="280px"
      :title="t('page.app-shell.s1')"
      class="mobile-drawer"
    >
      <nav class="nav">
        <div
          v-for="g in visibleGroups"
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
              v-if="item.migrated"
              :to="item.href"
              class="nav-item"
              @click="mobileOpen = false"
            >
              <el-icon :size="16">
                <component :is="item.icon" />
              </el-icon>
              <span>{{ t(item.labelKey) }}</span>
            </router-link>
            <a
              v-else
              :href="item.href"
              class="nav-item"
              @click="mobileOpen = false"
            >
              <el-icon :size="16"><component :is="item.icon" /></el-icon>
              <span>{{ t(item.labelKey) }}</span>
            </a>
          </template>
        </div>
      </nav>
    </el-drawer>

    <!-- 主区 -->
    <div class="main">
      <header class="topbar">
        <button
          class="menu-btn lg:hidden"
          :aria-label="t('page.app-shell.s22')"
          @click="mobileOpen = true"
        >
          <el-icon :size="16">
            <Menu />
          </el-icon>
        </button>
        <h1 class="page-title">
          {{ title }}
        </h1>

        <div class="topbar-right">
          <button
            class="search-btn hidden sm:inline-flex"
            :aria-label="t('page.app-shell.s23')"
            @click="searchOpen = true"
          >
            <el-icon :size="14">
              <Search />
            </el-icon>
            <span class="search-label">{{ t("page.app-shell.s2") }}</span>
            <kbd class="kbd">⌘K</kbd>
          </button>
          <button
            class="icon-btn sm:hidden"
            :aria-label="t('page.app-shell.s23')"
            @click="searchOpen = true"
          >
            <el-icon :size="14">
              <Search />
            </el-icon>
          </button>

          <el-popover
            v-model:visible="notifOpen"
            placement="bottom-end"
            :width="360"
            trigger="click"
          >
            <template #reference>
              <button
                class="icon-btn"
                :aria-label="t('page.app-shell.s3')"
                @click="notifOpen = !notifOpen"
              >
                <el-icon :size="14">
                  <BellFilled />
                </el-icon>
                <span
                  v-if="unread > 0"
                  class="unread-badge"
                >{{ unread > 9 ? "9+" : unread }}</span>
              </button>
            </template>
            <div class="notif-panel">
              <div class="notif-head">
                <span>{{ t("page.app-shell.s3") }}</span>
                <button
                  v-if="unread > 0"
                  class="notif-markall"
                  @click="doMarkAllRead"
                >
                  <el-icon :size="12">
                    <Finished />
                  </el-icon> {{ t("page.app-shell.s33") }}
                </button>
              </div>
              <div class="notif-list">
                <div
                  v-if="notifs.length === 0"
                  class="notif-empty"
                >
                  {{ t("page.app-shell.s4") }}
                </div>
                <button
                  v-for="n in notifs"
                  :key="n.id"
                  type="button"
                  class="notif-item"
                  :class="{ unread: !n.read }"
                  @click="openNotif(n)"
                >
                  <span
                    class="notif-icon"
                    :class="{ alert: n.type === 'securityAlert' }"
                  >
                    <el-icon :size="13"><component :is="NOTIF_ICON[n.type] ?? BellFilled" /></el-icon>
                  </span>
                  <span class="notif-body">
                    <span class="notif-title">
                      <span
                        v-if="!n.read"
                        class="dot"
                      />{{ n.title }}
                    </span>
                    <span class="notif-desc">{{ n.body }}</span>
                    <span class="notif-time">{{ formatRelative(n.createdAt) }}</span>
                  </span>
                </button>
              </div>
            </div>
          </el-popover>

          <el-dropdown
            trigger="click"
            @command="setLocale"
          >
            <button
              class="icon-btn"
              :aria-label="t('page.app-shell.s24')"
            >
              <el-icon :size="14">
                <Compass />
              </el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="zh-CN"
                  :class="{ active: locale === 'zh-CN' }"
                >
                  {{ t("common.chinese") }}
                </el-dropdown-item>
                <el-dropdown-item
                  command="en"
                  :class="{ active: locale === 'en' }"
                >
                  {{ t("common.english") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <ThemeToggle />

          <el-dropdown
            v-if="user"
            trigger="click"
            @command="onUserCommand"
          >
            <button class="user-btn">
              <span class="user-avatar">{{ user.name.charAt(0) }}</span>
              <span class="hidden sm:inline-block user-meta">
                <span class="user-name">{{ user.name }}</span>
                <span class="user-role">{{ ROLE_BADGE[user.role] ?? user.role }}</span>
              </span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <div class="usermenu-head">
                  <div class="usermenu-name">
                    {{ user.name }}
                  </div>
                  <div class="usermenu-email">
                    {{ user.email }}
                  </div>
                  <span class="usermenu-role">{{ ROLE_BADGE[user.role] ?? user.role }}</span>
                </div>
                <el-dropdown-item command="/settings?tab=security">
                  <el-icon><CircleCheck /></el-icon> {{ t("page.app-shell.s29") }}
                </el-dropdown-item>
                <el-dropdown-item
                  command="logout"
                  class="danger"
                >
                  <el-icon><SwitchButton /></el-icon> {{ t("page.app-shell.s34") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100dvh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.sidebar {
  width: 256px;
  flex-shrink: 0;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--card) / 0.5);
  display: flex;
  flex-direction: column;
}
.side-head {
  display: flex;
  height: 64px;
  align-items: center;
  padding: 0 20px;
}
.ws-box {
  padding: 0 12px 8px;
}
.ws-btn {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.ws-btn:hover {
  background: hsl(var(--accent) / 0.5);
}
.ws-avatar {
  display: flex;
  height: 24px;
  width: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.ws-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.ws-menu {
  display: grid;
  gap: 2px;
}
.ws-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  text-align: left;
}
.ws-item:hover {
  background: hsl(var(--accent));
}
.ws-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.ws-item-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-plan {
  font-size: 10px;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
.ws-create {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid hsl(var(--border));
}
.ws-add {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.ws-add:hover {
  background: hsl(var(--accent));
}
.ws-input {
  height: 28px;
  min-width: 0;
  flex: 1;
  padding: 0 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  font-size: 12px;
}
.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
  padding: 16px 12px;
}
.nav-group {
  display: grid;
  gap: 4px;
}
.nav-title {
  margin: 0 0 4px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: hsl(var(--muted-foreground));
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.nav-item:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.nav-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.upgrade {
  margin: 12px;
  padding: 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.1), transparent);
}
.upgrade-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.upgrade-desc {
  margin: 6px 0 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.upgrade-btn {
  display: inline-flex;
  height: 32px;
  width: 100%;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
}
.upgrade-btn:hover {
  filter: brightness(1.05);
}
.main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  height: 64px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(16px);
}
@media (min-width: 640px) {
  .topbar {
    padding: 0 24px;
  }
}
.menu-btn {
  display: inline-flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: none;
  cursor: pointer;
  color: inherit;
}
.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.search-btn {
  display: inline-flex;
  height: 36px;
  width: 200px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
@media (min-width: 1024px) {
  .search-btn {
    width: 224px;
  }
}
.search-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.search-label {
  min-width: 0;
  flex: 1;
  text-align: left;
}
.kbd {
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid hsl(var(--border));
  border-radius: 4px;
  background: hsl(var(--muted));
  font-size: 10px;
}
.icon-btn {
  position: relative;
  display: inline-flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  font: inherit;
}
.icon-btn:hover {
  color: hsl(var(--foreground));
}
.unread-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  display: flex;
  height: 16px;
  min-width: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 9999px;
  background: hsl(var(--destructive));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 0 0 2px hsl(var(--background));
}
.notif-panel {
  display: grid;
}
.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid hsl(var(--border));
  font-size: 14px;
  font-weight: 600;
}
.notif-markall {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: hsl(var(--primary));
}
.notif-list {
  max-height: 320px;
  overflow-y: auto;
}
.notif-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.notif-item {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid hsl(var(--border));
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.notif-item:last-child {
  border-bottom: 0;
}
.notif-item:hover {
  background: hsl(var(--accent) / 0.4);
}
.notif-item.unread {
  background: hsl(var(--primary) / 0.05);
}
.notif-icon {
  display: flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.notif-icon.alert {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}
.notif-body {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.notif-title {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.dot {
  height: 6px;
  width: 6px;
  flex-shrink: 0;
  border-radius: 9999px;
  background: hsl(var(--primary));
}
.notif-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.notif-time {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
  padding: 4px 8px 4px 4px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  cursor: pointer;
  font: inherit;
}
.user-btn:hover {
  background: hsl(var(--accent));
}
.user-avatar {
  display: flex;
  height: 26px;
  width: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.user-meta {
  display: grid;
  text-align: left;
}
.user-name {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
}
.user-role {
  font-size: 11px;
  line-height: 1.2;
  color: hsl(var(--muted-foreground));
}
.usermenu-head {
  padding: 8px 12px;
  border-bottom: 1px solid hsl(var(--border));
}
.usermenu-name {
  font-size: 14px;
  font-weight: 500;
}
.usermenu-email {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.usermenu-role {
  display: inline-flex;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.usermenu-head + .el-dropdown-menu__item {
  margin-top: 4px;
}
.danger {
  color: hsl(var(--destructive));
}
.content {
  flex: 1;
  padding: 16px;
}
@media (min-width: 640px) {
  .content {
    padding: 24px;
  }
}
@media (min-width: 1024px) {
  .content {
    padding: 32px;
  }
}
.hidden {
  display: none !important;
}
@media (min-width: 1024px) {
  .lg\:hidden {
    display: none !important;
  }
}
@media (min-width: 1024px) {
  .hidden.lg\:block {
    display: flex !important;
  }
}
@media (min-width: 640px) {
  .sm\:hidden {
    display: none !important;
  }
}
@media (min-width: 640px) {
  .hidden.sm\:inline-flex {
    display: inline-flex !important;
  }
}
@media (min-width: 640px) {
  .hidden.sm\:inline-block {
    display: inline-block !important;
  }
}
</style>
