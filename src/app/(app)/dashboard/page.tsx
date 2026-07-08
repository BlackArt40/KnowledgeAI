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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { UsageChart } from "@/components/app/usage-chart";
import { cn } from "@/lib/utils";

const stats = [
  {
    label: "本月问答",
    value: "1,284",
    sub: "次",
    trend: "+12.5%",
    icon: MessagesSquare,
  },
  {
    label: "剩余额度",
    value: "8,716",
    sub: "次",
    trend: "免费版",
    icon: Coins,
    muted: true,
  },
  {
    label: "知识库",
    value: "6",
    sub: "个",
    trend: "+2 本月",
    icon: Library,
  },
  {
    label: "文档总数",
    value: "348",
    sub: "篇",
    trend: "+24 本月",
    icon: FileText,
  },
];

const recentQA = [
  {
    q: "2026 年 AI 工程师就业趋势如何？",
    kb: "产品文档",
    time: "2 分钟前",
  },
  { q: "本季度核心业务指标是多少？", kb: "财务报告", time: "1 小时前" },
  { q: "新版本有哪些破坏性变更？", kb: "更新日志", time: "昨天" },
  { q: "API 限流策略是什么？", kb: "API 文档", time: "昨天" },
  { q: "如何配置 SSO 单点登录？", kb: "运维手册", time: "2 天前" },
];

const agentTasks = [
  {
    title: "2026 AI 就业市场调研",
    status: "running",
    progress: 60,
    step: "Analyze",
  },
  { title: "竞品定价策略分析", status: "done", progress: 100, step: "完成" },
  { title: "季度技术趋势报告", status: "done", progress: 100, step: "完成" },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* welcome */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            欢迎回来，王同学 👋
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
                <span className="text-2xl font-bold tracking-tight">
                  {s.value}
                </span>
                <span className="text-sm text-muted-foreground">{s.sub}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* usage chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">用量趋势</CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" /> 每日问答
              </span>
              <Badge variant="success" className="text-[11px]">
                近 14 天
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <UsageChart />
          </CardContent>
        </Card>

        {/* agent tasks */}
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
            {agentTasks.map((t) => (
              <div
                key={t.title}
                className="rounded-xl border border-border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-medium">
                    {t.title}
                  </span>
                  {t.status === "running" ? (
                    <Badge variant="default" className="shrink-0">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t.step}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                      {t.step}
                    </Badge>
                  )}
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      t.status === "running" ? "bg-brand-gradient" : "bg-success"
                    )}
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
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
          {recentQA.map((qa, i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <Avatar
                fallback="W"
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
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
