"use client";

import * as React from "react";
import {
  MessagesSquare, KeyRound, HardDrive, Bot, TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { UsageChart } from "@/components/app/usage-chart";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Usage } from "@/lib/billing/types";

interface UsageData { usage: Usage; plan: string }

export default function UsagePage() {
  const [data, setData] = React.useState<UsageData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/usage", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const { usage, plan } = data;
  const trendData = usage.trend.map((t) => t.qa);
  const trendLabels = usage.trend.map((t) => t.date);

  const meters = [
    {
      icon: MessagesSquare, label: "智能问答", used: usage.qaUsed,
      limit: usage.qaLimit, unit: "次", accent: "text-primary",
    },
    {
      icon: KeyRound, label: "API 调用", used: usage.apiCalls,
      limit: null, unit: "次", accent: "text-emerald-500",
    },
    {
      icon: HardDrive, label: "存储用量", used: usage.storageUsed,
      limit: usage.storageLimit, unit: "", fmt: true, accent: "text-amber-500",
    },
    {
      icon: Bot, label: "Agent 任务", used: usage.agentTasks,
      limit: usage.agentLimit, unit: "次", accent: "text-violet-500",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">用量统计</h2>
          <p className="mt-1 text-sm text-muted-foreground">本周期资源使用情况</p>
        </div>
        <Badge variant="default">{plan === "pro" ? "专业版" : plan === "enterprise" ? "企业版" : "免费版"}</Badge>
      </div>

      {/* meter cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {meters.map((m) => {
          const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
          const usedStr = m.fmt ? formatSize(m.used) : m.used.toLocaleString();
          const limitStr = m.limit === null ? "无限" : m.fmt ? formatSize(m.limit) : m.limit.toLocaleString();
          return (
            <Card key={m.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted", m.accent)}>
                    <m.icon className="h-[18px] w-[18px]" />
                  </span>
                  {m.limit !== null && pct > 80 && <Badge variant="warning" className="text-[10px]">即将达限</Badge>}
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl font-bold tracking-tight tabular-nums">{usedStr}</span>
                  <span className="text-xs text-muted-foreground">/ {limitStr}{m.unit && m.limit !== null ? ` ${m.unit}` : ""}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{m.label}</p>
                {m.limit !== null && (
                  <Progress value={pct} className="mt-3 h-1.5" indicatorClassName={pct > 80 ? "bg-warning" : "bg-brand-gradient"} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* trend */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" /> 用量趋势
          </CardTitle>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" /> 每日问答
            </span>
            <Badge variant="secondary" className="text-[11px]">近 14 天</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <UsageChart data={trendData} labels={trendLabels} />
        </CardContent>
      </Card>
    </div>
  );
}
