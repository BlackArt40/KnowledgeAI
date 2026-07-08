"use client";
import * as React from "react";
import Link from "next/link";
import {
  MessagesSquare,
  Coins,
  Library,
  FileText,
  TrendingUp,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Loader2,
  Plus,
  Inbox,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { UsageChart } from "@/components/app/usage-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CurrentUser {
  name: string;
  role: string;
  plan: string;
}

// Roles that can access Agent (matches RBAC + route guard)
const AGENT_ROLES = ["owner", "admin", "editor"];
interface KbItem {
  id: string;
  name: string;
  stats?: { total: number; ready: number; processing: number; chunks: number };
}
interface Conversation {
  id: string;
  kbId: string;
  title: string;
  messages: { role: string; content: string; createdAt: number }[];
  updatedAt: number;
}
interface AgentTask {
  id: string;
  topic: string;
  status: "queued" | "running" | "done" | "failed";
  steps: { role: string; status: string; progress: number }[];
  updatedAt: number;
}

const AGENT_STEP_LABEL: Record<string, string> = {
  planner: "规划",
  searcher: "检索",
  analyzer: "分析",
  writer: "撰写",
};

export default function DashboardPage() {
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [kbs, setKbs] = React.useState<KbItem[]>([]);
  const [convs, setConvs] = React.useState<Conversation[]>([]);
  const [tasks, setTasks] = React.useState<AgentTask[]>([]);
  const [qaUsed, setQaUsed] = React.useState(0);
  const [qaLimit, setQaLimit] = React.useState<number | null>(null);
  const [trend, setTrend] = React.useState<{ date: string; qa: number }[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const [meRes, kbRes, usageRes, convRes, taskRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/knowledge-base", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/usage", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/chat/conversations?limit=5", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/agent/tasks", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (meRes.user) setUser(meRes.user);
        setKbs(kbRes.kbs ?? []);
        const u = usageRes.usage;
        if (u) {
          setQaUsed(u.qaUsed ?? 0);
          setQaLimit(u.qaLimit ?? null);
          setTrend((u.trend ?? []).map((t: { date: string; qa: number }) => ({ date: t.date, qa: t.qa })));
        }
        setConvs(convRes.conversations ?? []);
        setTasks(taskRes.tasks ?? []);
      } catch {
        /* network error - keep defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalDocs = kbs.reduce((sum, kb) => sum + (kb.stats?.total ?? 0), 0);
  const kbMap = React.useMemo(() => {
    const m = new Map<string, string>();
    kbs.forEach((kb) => m.set(kb.id, kb.name));
    return m;
  }, [kbs]);

  const stats = [
    {
      label: "本月问答",
      value: qaUsed.toLocaleString(),
      sub: "次",
      trend: qaLimit ? "用量正常" : "无限",
      icon: MessagesSquare,
      muted: false,
    },
    {
      label: "剩余额度",
      value: qaLimit === null ? "∞" : (qaLimit - qaUsed).toLocaleString(),
      sub: "次",
      trend: user?.plan ? user.plan : "免费版",
      icon: Coins,
      muted: true,
    },
    {
      label: "知识库",
      value: String(kbs.length),
      sub: "个",
      trend: kbs.length > 0 ? "已创建" : "暂无",
      icon: Library,
      muted: false,
    },
    {
      label: "文档总数",
      value: totalDocs.toLocaleString(),
      sub: "篇",
      trend: totalDocs > 0 ? "已索引" : "暂无",
      icon: FileText,
      muted: false,
    },
  ];

  const recentQA = convs.slice(0, 5).map((c) => {
    const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
    return {
      id: c.id,
      q: lastUser?.content ?? c.title,
      kb: kbMap.get(c.kbId) ?? "未知知识库",
      time: formatRelative(c.updatedAt),
    };
  });

  function taskProgress(t: AgentTask): number {
    if (t.status === "done") return 100;
    if (t.status === "queued") return 0;
    const done = t.steps.filter((s) => s.status === "done").length;
    return t.steps.length > 0 ? Math.round((done / t.steps.length) * 100) : 0;
  }
  function taskStepLabel(t: AgentTask): string {
    if (t.status === "done") return "完成";
    if (t.status === "failed") return "失败";
    if (t.status === "queued") return "排队中";
    const running = t.steps.find((s) => s.status === "running");
    return running ? AGENT_STEP_LABEL[running.role] ?? running.role : "进行中";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* welcome */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {loading ? (
              <Skeleton className="inline-block h-7 w-48" />
            ) : (
              <>欢迎回来，{user?.name ?? "用户"} 👋</>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            这是你的知识工作台概览。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/knowledge-base">
              <Plus className="h-4 w-4" /> 新建知识库
            </Link>
          </Button>
          <Button variant="gradient" asChild>
            <Link href="/chat">
              <MessagesSquare className="h-4 w-4" /> 开始问答
            </Link>
          </Button>
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="h-[18px] w-[18px]" />
                </span>
                {!s.muted ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-success">
                    <TrendingUp className="h-3 w-3" />
                    {s.trend}
                  </span>
                ) : (
                  <Badge variant="secondary" className="text-[11px]">
                    {s.trend}
                  </Badge>
                )}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                {loading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <span className="text-2xl font-bold tracking-tight">
                    {s.value}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">{s.sub}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* usage chart */}
        <Card className={user && AGENT_ROLES.includes(user.role) ? "lg:col-span-2" : "lg:col-span-3"}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">用量趋势</CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" /> 每日问答
              </span>
              <Badge variant="success" className="text-[11px]">
                近 {trend.length || 14} 天
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : (
              <UsageChart
                data={trend.length > 0 ? trend.map((t) => t.qa) : undefined}
                labels={trend.length > 0 ? trend.map((t) => t.date) : undefined}
              />
            )}
          </CardContent>
        </Card>

        {/* agent tasks - only for roles with agent access */}
        {user && AGENT_ROLES.includes(user.role) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              <span className="inline-flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" /> Agent 任务
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/agent">
                全部 <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Inbox className="h-8 w-8 opacity-40" />
                <p className="text-sm">暂无 Agent 任务</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/agent">
                    <Bot className="h-4 w-4" /> 发起调研
                  </Link>
                </Button>
              </div>
            ) : (
              tasks.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium">
                      {t.topic}
                    </span>
                    {t.status === "running" ? (
                      <Badge variant="default" className="shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {taskStepLabel(t)}
                      </Badge>
                    ) : t.status === "failed" ? (
                      <Badge variant="destructive" className="shrink-0">
                        {taskStepLabel(t)}
                      </Badge>
                    ) : (
                      <Badge variant="success" className="shrink-0">
                        <CheckCircle2 className="h-3 w-3" />
                        {taskStepLabel(t)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        t.status === "running" ? "bg-brand-gradient" : "bg-success"
                      )}
                      style={{ width: `${taskProgress(t)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        )}

      </div>

      {/* recent qa */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">最近问答</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/chat">
              查看全部 <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {loading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : recentQA.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              <p className="text-sm">还没有问答记录</p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/chat">
                  <MessagesSquare className="h-4 w-4" /> 开始问答
                </Link>
              </Button>
            </div>
          ) : (
            recentQA.map((qa) => (
              <Link
                key={qa.id}
                href="/chat"
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-accent/40"
              >
                <Avatar
                  fallback={(user?.name ?? "U")[0]}
                  className="h-8 w-8 bg-primary/10 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{qa.q}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {qa.kb}
                    </Badge>
                    <span>{qa.time}</span>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
