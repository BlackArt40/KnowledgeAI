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

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "工作区",
    items: [
      { label: "仪表盘", href: "/dashboard", icon: LayoutDashboard },
      { label: "知识库", href: "/knowledge-base", icon: Library },
      { label: "智能问答", href: "/chat", icon: MessagesSquare },
      { label: "Agent 调研", href: "/agent", icon: Bot, },
    ],
  },
  {
    title: "协作与计费",
    items: [
      { label: "团队", href: "/team", icon: Users },
      { label: "订阅计费", href: "/billing", icon: CreditCard },
      { label: "用量统计", href: "/usage", icon: Gauge },
    ],
  },
  {
    title: "系统",
    items: [
      { label: "API 密钥", href: "/api-keys", icon: KeyRound },
      { label: "设置", href: "/settings", icon: Settings },
      { label: "管理后台", href: "/admin", icon: ShieldCheck },
    ],
  },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
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
        ))}
      </nav>

      {/* upgrade card */}
      <div className="m-3 rounded-xl border border-border bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">升级专业版</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          解锁 Agent 调研与无限问答
        </p>
        <Link
          href="/billing"
          className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-lg bg-brand-gradient text-xs font-medium text-white transition hover:brightness-105"
        >
          立即升级
        </Link>
      </div>
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

  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setUser(d.user);
        else router.push("/login");
      })
      .catch(() => router.push("/login"));
  }, [router]);

  function logout() {
    localStorage.removeItem("kai-token");
    document.cookie = "kai-token=; path=/; max-age=0";
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card/50 lg:block">
        <SidebarContent />
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
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
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
            <button
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="通知"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
            </button>
            <ThemeToggle />
            <div className="relative ml-1">
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
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
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
