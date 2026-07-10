"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Library,
  MessagesSquare,
  Bot,
  Users,
  CreditCard,
  Gauge,
  KeyRound,
  Settings,
  Menu,
  X,
  Search,
  Bell,
  ShieldAlert,
  Mail,
  CheckCheck,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

type Role = "owner" | "admin" | "editor" | "viewer";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[]; // undefined = all roles
};

// Role-based navigation access (aligned with RBAC permission matrix)
const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "工作区",
    items: [
      { label: "仪表盘", href: "/dashboard", icon: LayoutDashboard },
      { label: "知识库", href: "/knowledge-base", icon: Library },
      { label: "智能问答", href: "/chat", icon: MessagesSquare },
      { label: "Agent 调研", href: "/agent", icon: Bot, roles: ["owner", "admin", "editor"] },
    ],
  },
  {
    title: "协作与计费",
    items: [
      { label: "团队", href: "/team", icon: Users },
      { label: "订阅计费", href: "/billing", icon: CreditCard, roles: ["owner", "admin"] },
      { label: "用量统计", href: "/usage", icon: Gauge, roles: ["owner", "admin", "editor"] },
    ],
  },
  {
    title: "系统",
    items: [
      { label: "API 密钥", href: "/api-keys", icon: KeyRound, roles: ["owner", "admin", "editor"] },
      { label: "设置", href: "/settings", icon: Settings },
      { label: "管理后台", href: "/admin", icon: ShieldCheck, roles: ["owner", "admin"] },
    ],
  },
];

function SidebarContent({ onNavigate, role, plan }: { onNavigate?: () => void; role?: string; plan?: string }) {
  const pathname = usePathname();

  // Filter nav items by role; items without `roles` are visible to everyone
  const canSee = (item: NavItem) => !item.roles || (role && item.roles.includes(role as Role));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => {
          const items = group.items.filter(canSee);
          if (items.length === 0) return null;
          return (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-1">
              {items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    {item.label}
                    {item.label === "Agent 调研" && (
                      <Badge variant="default" className="ml-auto px-1.5 py-0 text-[10px]">
                        新
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>

      {/* upgrade card - only show for free-plan users */}
      {(!plan || plan === "free") && (
      <div className="m-3 rounded-xl border border-border bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">升级专业版</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          解锁 Agent 调研与无限问答
        </p>
        <Link
          href="/checkout?plan=pro"
          className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-lg bg-brand-gradient text-xs font-medium text-white transition hover:brightness-105"
        >
          立即升级
        </Link>
      </div>
      )}
    </div>
  );
}


const titleMap: Record<string, string> = {
  "/dashboard": "仪表盘",
  "/knowledge-base": "知识库",
  "/chat": "智能问答",
  "/agent": "Agent 调研",
  "/team": "团队",
  "/billing": "订阅计费",
  "/usage": "用量统计",
  "/api-keys": "API 密钥",
  "/settings": "设置",
  "/admin": "管理后台",
  "/checkout": "收银台",
};

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
}

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = titleMap[pathname] ?? "工作台";
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [userMenu, setUserMenu] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const notifRef = React.useRef<HTMLDivElement>(null);
  const [notifs, setNotifs] = React.useState<{ id: string; type: string; title: string; body: string; read: boolean; createdAt: number; link?: string }[]>([]);
  const [unread, setUnread] = React.useState(0);

  const refreshNotifs = React.useCallback(async () => {
    try {
      const d = await fetch("/api/notifications?limit=10", { cache: "no-store" }).then((r) => r.json());
      setNotifs(d.notifications ?? []);
      setUnread(d.unread ?? 0);
    } catch { /* ignore */ }
  }, []);
  React.useEffect(() => {
    refreshNotifs();
    const t = setInterval(refreshNotifs, 30000);
    return () => clearInterval(t);
  }, [refreshNotifs]);

  // Close notification dropdown when clicking outside
  React.useEffect(() => {
    if (!notifOpen) return;
    function handleOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [notifOpen]);

  // Close user menu when clicking outside
  React.useEffect(() => {
    if (!userMenu) return;
    function handleOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [userMenu]);

  // Route -> allowed roles (must match navGroups roles). Checked on every navigation.
  const routeGuard = React.useCallback((role: string | undefined, path: string) => {
    const RESTRICTED: Record<string, Role[]> = {
      "/admin": ["owner", "admin"],
      "/billing": ["owner", "admin"],
      "/agent": ["owner", "admin", "editor"],
      "/usage": ["owner", "admin", "editor"],
      "/api-keys": ["owner", "admin", "editor"],
    };
    for (const [prefix, roles] of Object.entries(RESTRICTED)) {
      if (path === prefix || path.startsWith(prefix + "/")) {
        if (!role || !roles.includes(role as Role)) return false;
      }
    }
    return true;
  }, []);

  // Fetch current user once on mount
  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setUser(d.user);
        else router.push("/login");
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Route guard: redirect unauthorized users when path or role changes
  React.useEffect(() => {
    if (user && !routeGuard(user.role, pathname)) {
      router.replace("/dashboard");
    }
  }, [user, pathname, routeGuard, router]);

  function logout() {
    localStorage.removeItem("kai-token");
    document.cookie = "kai-token=; path=/; max-age=0";
    router.push("/login");
  }

  async function markAllRead() {
    setUnread(0);
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markAllRead" }),
    });
  }

  async function markOneRead(id: string) {
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
  }

  const NOTIF_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    kbReady: Library, agentDone: Bot, securityAlert: ShieldAlert, emailDigest: Mail,
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card/50 lg:block">
        <SidebarContent role={user?.role} plan={user?.plan} />
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-border bg-card shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} role={user?.role} plan={user?.plan} />
          </aside>
        </div>
      )}

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border lg:hidden"
            aria-label="打开菜单"
          >
            <Menu className="h-4 w-4" />
          </button>

          <h1 className="text-base font-semibold sm:text-lg">{title}</h1>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="搜索…"
                className="h-9 w-44 rounded-lg border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-56"
              />
            </div>
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                aria-label="通知"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-background">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:w-96">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <span className="text-sm font-semibold">通知</span>
                      {unread > 0 && (
                        <button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <CheckCheck className="h-3 w-3" /> 全部已读
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifs.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">暂无通知</div>
                      ) : (
                        notifs.map((n) => {
                          const Icon = NOTIF_ICON[n.type] ?? Bell;
                          return (
                            <button
                              key={n.id}
                              onClick={() => { if (!n.read) markOneRead(n.id); if (n.link) { router.push(n.link); setNotifOpen(false); } }}
                              className={cn(
                                "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent/40",
                                !n.read && "bg-primary/5"
                              )}
                            >
                              <span className={cn(
                                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                                n.type === "securityAlert" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                              )}>
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                                  <p className="truncate text-sm font-medium">{n.title}</p>
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRelative(n.createdAt)}</p>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
              )}
            </div>
            <ThemeToggle />
            <div className="relative ml-1" ref={userMenuRef}>
              <button
                onClick={() => setUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-border bg-card p-1 pr-2 transition-colors hover:bg-accent"
              >
                <Avatar fallback={user?.name?.[0] ?? "U"} />
                <div className="hidden text-left sm:block">
                  <div className="text-xs font-medium leading-tight">{user?.name ?? "加载中…"}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    {user ? ROLE_BADGE[user.role] ?? user.role : ""}
                  </div>
                </div>
                <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
              </button>
              {userMenu && (
                <>
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-xl">
                    <div className="border-b border-border px-3 py-2">
                      <div className="text-sm font-medium">{user?.name}</div>
                      <div className="text-xs text-muted-foreground">{user?.email}</div>
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {user ? ROLE_BADGE[user.role] ?? user.role : ""}
                      </div>
                    </div>
                    <button
                      onClick={logout}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/5"
                    >
                      <LogOut className="h-4 w-4" /> 退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
