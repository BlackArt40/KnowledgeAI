import { createRouter, createWebHistory } from "vue-router";

// V1：认证 6 页 + 静态 3 页 + 分享 2 页已由 Vue 接管（网关 routes.conf 对齐）。
// 布局约定：认证页用 AuthLayout 包裹（复刻 Next (auth) 组布局）；静态/分享页
// 独立无壳（与 Next 顶级路由一致）。V2+ 逐阶段补齐其余页面。
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      // 营销首页（V5；构建期预渲染 dist/home.html 保 SEO，浏览器端接管交互）
      component: () => import("@/views/HomeView.vue"),
    },

    // ── 工作台（(app) 组，AppShell 包裹；meta.shell 由 App.vue 判断）────
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("@/views/DashboardView.vue"),
      meta: { shell: true },
    },
    {
      path: "/settings",
      name: "settings",
      // 深链接契约：/settings?tab=security|profile|privacy|models|appearance
      component: () => import("@/views/SettingsView.vue"),
      meta: { shell: true },
    },
    {
      path: "/knowledge-base",
      name: "knowledge-base",
      // 深链接契约：/knowledge-base?new=1 打开新建对话框
      component: () => import("@/views/KbListView.vue"),
      meta: { shell: true },
    },
    {
      path: "/knowledge-base/:id",
      name: "kb-detail",
      component: () => import("@/views/KbDetailView.vue"),
      meta: { shell: true },
    },
    {
      path: "/knowledge-base/:id/graph",
      name: "kb-graph",
      component: () => import("@/views/KbGraphView.vue"),
      meta: { shell: true },
    },
    {
      path: "/team",
      name: "team",
      component: () => import("@/views/TeamView.vue"),
      meta: { shell: true },
    },
    {
      path: "/api-keys",
      name: "api-keys",
      component: () => import("@/views/ApiKeysView.vue"),
      meta: { shell: true },
    },

    // ── 聊天 / Agent / 账务（V4，AppShell 包裹）────────────────────────
    {
      path: "/chat",
      name: "chat",
      // 深链接契约：/chat?kb=&conv=（全局搜索/仪表盘最近问答跳转）
      component: () => import("@/views/ChatView.vue"),
      meta: { shell: true },
    },
    {
      path: "/agent",
      name: "agent",
      // 深链接契约：/agent?task=（全局搜索任务结果跳转）
      component: () => import("@/views/AgentView.vue"),
      meta: { shell: true },
    },
    {
      path: "/billing",
      name: "billing",
      component: () => import("@/views/BillingView.vue"),
      meta: { shell: true },
    },
    {
      path: "/checkout",
      name: "checkout",
      // 深链接契约：/checkout?plan=pro|enterprise|free
      component: () => import("@/views/CheckoutView.vue"),
      meta: { shell: true },
    },
    {
      path: "/usage",
      name: "usage",
      component: () => import("@/views/UsageView.vue"),
      meta: { shell: true },
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("@/views/AdminView.vue"),
      meta: { shell: true },
    },
    {
      path: "/admin/monitoring",
      name: "admin-monitoring",
      component: () => import("@/views/MonitoringView.vue"),
      meta: { shell: true },
    },
    {
      path: "/developer",
      name: "developer",
      component: () => import("@/views/DeveloperView.vue"),
      meta: { shell: true },
    },

    // ── 独立页（无壳）────────────────────────────────────────────────
    {
      path: "/docs",
      name: "docs",
      // OpenAPI 文档（Swagger UI，独立无壳页，与 Next 版一致）
      component: () => import("@/views/DocsView.vue"),
    },

    // ── 认证（(auth) 组，AuthLayout 分屏壳）────────────────────────────
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/auth/LoginView.vue"),
      meta: { auth: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("@/views/auth/RegisterView.vue"),
      meta: { auth: true },
    },
    {
      path: "/verify-email",
      name: "verify-email",
      component: () => import("@/views/auth/VerifyEmailView.vue"),
      meta: { auth: true },
    },
    {
      path: "/forgot-password",
      name: "forgot-password",
      component: () => import("@/views/auth/ForgotPasswordView.vue"),
      meta: { auth: true },
    },
    {
      path: "/reset-password",
      name: "reset-password",
      component: () => import("@/views/auth/ResetPasswordView.vue"),
      meta: { auth: true },
    },
    {
      path: "/2fa-enroll",
      name: "2fa-enroll",
      component: () => import("@/views/auth/TwoFactorEnrollView.vue"),
      meta: { auth: true },
    },

    // ── 静态页（无壳，与 Next 顶级路由一致）────────────────────────────
    {
      path: "/privacy",
      name: "privacy",
      component: () => import("@/views/static/PrivacyView.vue"),
    },
    {
      path: "/terms",
      name: "terms",
      component: () => import("@/views/static/TermsView.vue"),
    },
    {
      path: "/maintenance",
      name: "maintenance",
      component: () => import("@/views/static/MaintenanceView.vue"),
    },

    // ── 公开分享（令牌即凭据）──────────────────────────────────────────
    {
      path: "/share-doc/:token",
      name: "share-doc",
      component: () => import("@/views/share/ShareDocView.vue"),
    },
    {
      path: "/r/:id",
      name: "report-share",
      component: () => import("@/views/share/SharedReportView.vue"),
    },

    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("@/views/NotFoundView.vue"),
    },
  ],
});

// 发版后旧 chunk 404 会让动态 import 失败并白屏：自动整页刷新一次；
// 30s 内重复失败则不再刷新，避免 chunk 真缺失时无限循环。
const CHUNK_RELOAD_KEY = "kai-chunk-reload-at";
router.onError((err) => {
  const msg = String((err as Error)?.message ?? err);
  if (!/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) return;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
  } catch {
    /* private mode */
  }
  if (Date.now() - last < 30_000) return;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
  window.location.reload();
});
