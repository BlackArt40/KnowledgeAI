<script setup lang="ts">
// AppShell（V2，复刻 src/components/app/app-shell.tsx）：
// 桌面侧栏 + 移动端抽屉 + 顶栏（标题/搜索/通知/语言/主题/用户菜单）。
// 导航路由区分已接管（router-link）与未迁移（<a> 整页跳转，跨壳纪律）。
// 401 → /login；网络失败保留壳（离线策略）；Cmd/Ctrl+K 开全局搜索。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import {
  BellFilled, Finished, WalletFilled, TrendCharts, Compass, Key, Notebook, Odometer, Collection, SwitchButton, Menu, ChatDotRound, MagicStick, Search,
  Setting, CircleCheck, User,
} from "@element-plus/icons-vue";
import { getI18nInstance } from "@kai/shared/i18n/translate";
import AppSidebar from "@/components/app-shell/AppSidebar.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";
import GlobalSearch from "@/components/GlobalSearch.vue";
import { fetchCurrentUser } from "@/api/auth";
import { ApiError, api } from "@/api/client";
import {
  currentWorkspaceName as currentName,
  onFreePlan,
  refreshWorkspaces,
  workspaceList as workspaces,
} from "@/lib/workspace-store";
import {
  fetchNotifications, markAllRead, markOneRead,
  type Notification,
} from "@/api/notifications";
import { formatRelative } from "@kai/shared/format";
import { usePresence } from "@/lib/presence";
import { subscribeEvents, type EventStreamHandle } from "@/lib/event-stream";

type Role = "owner" | "admin" | "editor" | "viewer";

interface NavItem {
  labelKey: string;
  href: string;
  icon: object;
  roles?: Role[];
}

// 角色导航（与 RBAC 矩阵对齐，路径/角色/文案 key 与 Next 版逐字一致）
const navGroups: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "page.app-shell.s5",
    items: [
      { labelKey: "page.app-shell.s6", href: "/dashboard", icon: Odometer },
      { labelKey: "page.app-shell.s7", href: "/knowledge-base", icon: Collection },
      { labelKey: "page.app-shell.s8", href: "/chat", icon: ChatDotRound },
      { labelKey: "page.app-shell.s9", href: "/agent", icon: MagicStick, roles: ["owner", "admin", "editor"] },
    ],
  },
  {
    titleKey: "page.app-shell.s10",
    items: [
      { labelKey: "page.app-shell.s11", href: "/team", icon: User },
      { labelKey: "page.app-shell.s12", href: "/billing", icon: WalletFilled, roles: ["owner", "admin"] },
      { labelKey: "page.app-shell.s13", href: "/usage", icon: TrendCharts, roles: ["owner", "admin", "editor"] },
    ],
  },
  {
    titleKey: "page.app-shell.s14",
    items: [
      { labelKey: "page.app-shell.s15", href: "/api-keys", icon: Key, roles: ["owner", "admin", "editor"] },
      { labelKey: "page.app-shell.s28", href: "/developer", icon: Notebook, roles: ["owner", "admin", "editor"] },
      { labelKey: "page.app-shell.s16", href: "/settings", icon: Setting },
      { labelKey: "page.app-shell.s17", href: "/admin", icon: CircleCheck, roles: ["owner", "admin"] },
      // P6-1 可观测看板（owner/admin）
      { labelKey: "page.app-shell.s27", href: "/admin/monitoring", icon: TrendCharts, roles: ["owner", "admin"] },
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
  "/admin": "page.app-shell.s17",
  "/admin/monitoring": "page.app-shell.s27",
  "/checkout": "page.checkout.s30",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
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

// P4-1 在线状态：长连接挂在壳上（打开流即在线），事件推全量在线列表
const { online: onlineUsers, start: presenceStart, stop: presenceStop } = usePresence();
const onlineCount = computed(() => onlineUsers.value.length);
const onlineNames = computed(() =>
  onlineUsers.value.map((u) => u.name || u.email || u.userId).join(", ")
);

const title = computed(() => {
  const path = String(route.path);
  const key = titleMap[path];
  if (key) return t(key);
  // 动态路由（知识库详情 / 图谱）走前缀匹配，避免一律回退到「工作台」
  if (path.startsWith("/knowledge-base/")) {
    return path.endsWith("/graph") ? t("page.knowledge-graph.s1") : t("page.app-shell.s7");
  }
  return t("page.app-shell.s20");
});
const locale = computed(() => i18n.language === "en" ? "en" : "zh-CN");

// 路由守卫（与 Next 版 RESTRICTED 一致），未授权跳 /dashboard
function routeGuard(role: string | undefined, path: string): boolean {
  const RESTRICTED: Record<string, Role[]> = {
    "/admin": ["owner", "admin"],
    "/billing": ["owner", "admin"],
    "/agent": ["owner", "admin", "editor", "viewer"],
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
let notifStream: EventStreamHandle | null = null;
let notifStreamOpen = false;

function startNotifPolling() {
  if (notifTimer) return;
  notifTimer = setInterval(() => void refreshNotifs(), 30_000);
}

function stopNotifPolling() {
  if (!notifTimer) return;
  clearInterval(notifTimer);
  notifTimer = null;
}

/** SSE 帧 → 铃铛状态（init 快照 / 新通知 / 未读数变化）。 */
function applyNotifEvent(event: Record<string, unknown>) {
  if (event.type === "init") {
    notifs.value = Array.isArray(event.notifications)
      ? (event.notifications as Notification[]).slice(0, 10)
      : [];
    unread.value = Number(event.unread ?? 0);
    return;
  }
  if (event.type === "notification") {
    const n = event.notification as Notification | undefined;
    if (n?.id && !notifs.value.some((x) => x.id === n.id)) {
      notifs.value = [n, ...notifs.value].slice(0, 10);
    }
    unread.value = Number(event.unread ?? unread.value + 1);
    return;
  }
  if (event.type === "unread") {
    unread.value = Number(event.unread ?? unread.value);
  }
}

function startNotifStream() {
  if (notifStream) return;
  // 长连接优先：连上即停轮询；断线由 subscribeEvents 自动重连，期间恢复
  // 30s 轮询兜底（网关/代理吞流时仍有未读更新）。
  notifStream = subscribeEvents("/api/notifications/events", {
    onOpen: () => {
      notifStreamOpen = true;
      stopNotifPolling();
      void refreshNotifs();
    },
    onError: () => {
      notifStreamOpen = false;
      startNotifPolling();
    },
    onEvent: applyNotifEvent,
  });
}

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
        // 套餐不挂在用户上（升级改的是 workspace.plan），见 lib/workspace-store.ts
      };
      if (!routeGuard(user.value?.role, route.path)) await router.replace("/dashboard");
      presenceStart();
      startNotifStream();
    }
  } catch {
    /* offline: keep shell */
  }
  void refreshNotifs();
  if (!notifStreamOpen) startNotifPolling();
  // 工作区列表 + 当前套餐（侧栏徽标 / 升级引导的唯一数据源）
  void refreshWorkspaces();
});

onBeforeUnmount(() => {
  stopNotifPolling();
  notifStream?.stop();
  notifStream = null;
  notifStreamOpen = false;
  presenceStop();
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
  kbReady: Collection,
  agentDone: MagicStick,
  securityAlert: BellFilled,
  emailDigest: BellFilled,
  teamActivity: User,
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
    <AppSidebar
      v-model:mobile-open="mobileOpen"
      :groups="visibleGroups"
      :current-name="currentName"
      :workspaces="workspaces"
      :on-free-plan="onFreePlan"
    />

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
            data-testid="search-entry"
            @click="searchOpen = true"
          >
            <el-icon :size="14">
              <Search />
            </el-icon>
            <span class="search-label">{{ t("page.app-shell.s2") }}</span>
            <!-- 可见文本必须包含在可访问名里；快捷键对名字没有信息量，排除掉。 -->
            <kbd
              class="kbd"
              aria-hidden="true"
            >⌘K</kbd>
          </button>
          <button
            class="icon-btn sm:hidden"
            data-testid="search-entry"
            :aria-label="t('page.app-shell.s23')"
            @click="searchOpen = true"
          >
            <el-icon :size="14">
              <Search />
            </el-icon>
          </button>

          <el-popover
            v-if="onlineCount > 0"
            placement="bottom-end"
            :width="248"
            trigger="click"
          >
            <template #reference>
              <button
                type="button"
                class="presence-chip"
                :aria-label="t('page.app-shell.s35', { count: onlineCount })"
                :title="onlineNames"
              >
                <span class="presence-dot" />
                {{ onlineCount }}
              </button>
            </template>
            <p class="presence-title">
              {{ t("page.app-shell.s36") }}
            </p>
            <ul class="presence-list">
              <li
                v-for="u in onlineUsers"
                :key="u.userId"
                class="presence-row"
              >
                <span class="presence-avatar">{{ (u.name || u.email || "?").charAt(0) }}</span>
                <span class="presence-name">
                  {{ u.name || u.email }}
                  <span
                    v-if="u.name && u.email"
                    class="presence-mail"
                  >{{ u.email }}</span>
                </span>
              </li>
            </ul>
          </el-popover>

          <el-popover
            v-model:visible="notifOpen"
            placement="bottom-end"
            :width="360"
            trigger="click"
          >
            <template #reference>
              <!-- 不要在这里再写 @click 手动 toggle：el-popover 的 trigger="click"
                   已经会翻 v-model:visible，两边同时翻转 = 点开即关（2026-10-24 修） -->
              <button
                class="icon-btn"
                data-testid="notif-bell"
              >
                <el-icon
                  :size="14"
                  aria-hidden="true"
                >
                  <BellFilled />
                </el-icon>
                <span class="sr-only">{{ t("page.app-shell.s3") }}</span>
                <span
                  v-if="unread > 0"
                  class="unread-badge"
                  aria-hidden="true"
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
              <div class="notif-list kai-scroll">
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
                    :class="{ alert: n.type === 'securityAlert', team: n.type === 'teamActivity' }"
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

<style scoped src="./app-shell/app-shell.css"></style>
