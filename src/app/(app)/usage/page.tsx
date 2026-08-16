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
import { useT } from "@/lib/i18n/provider";
import { useFormat } from "@/lib/i18n/use-format";
import { cn } from "@/lib/utils";
import type { Usage } from "@/lib/billing/types";

interface UsageData {
  // workspace-scoped meters (P4-3): no trend/apiCalls - those are per-user
  usage: {
    workspaceId: string;
    qaUsed: number;
    qaLimit: number | null;
    storageUsed: number;
    storageLimit: number | null;
    agentTasks: number;
    agentLimit: number | null;
    kbCount: number;
  };
  plan: string;
  /** per-user meters, incl. the QA/API trend series (Usage type). */
  userUsage?: Usage;
}

export default function UsagePage() {
  const t = useT();
  const { formatSize, formatNumber } = useFormat();
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

  const { usage, plan, userUsage } = data;
  // P4-3: the trend series lives on the per-user meters (userUsage), not on
  // the workspace usage object.
  const trend = userUsage?.trend ?? [];
  const trendData = trend.map((t) => t.qa);
  const trendLabels = trend.map((t) => t.date);

  const meters = [
    {
      icon: MessagesSquare, label: t("page.usage.meterQa"), used: usage.qaUsed,
      limit: usage.qaLimit, unit: t("page.usage.unitTimes"), accent: "text-primary",
    },
    {
      icon: KeyRound, label: t("page.usage.meterApi"), used: userUsage?.apiCalls ?? 0,
      limit: null, unit: t("page.usage.unitTimes"), accent: "text-emerald-500",
    },
    {
      icon: HardDrive, label: t("page.usage.meterStorage"), used: usage.storageUsed,
      limit: usage.storageLimit, unit: "", fmt: true, accent: "text-amber-500",
    },
    {
      icon: Bot, label: t("page.usage.meterAgent"), used: usage.agentTasks,
      limit: usage.agentLimit, unit: t("page.usage.unitTimes"), accent: "text-violet-500",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("page.usage.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("page.usage.subtitle")}</p>
        </div>
        <Badge variant="default">{plan === "pro" ? t("page.usage.planPro") : plan === "enterprise" ? t("page.usage.planEnt") : t("page.usage.planFree")}</Badge>
      </div>

      {/* meter cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {meters.map((m) => {
          const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
          const usedStr = m.fmt ? formatSize(m.used) : formatNumber(m.used);
          const limitStr = m.limit === null ? t("page.usage.limitInfinite") : m.fmt ? formatSize(m.limit) : formatNumber(m.limit);
          return (
            <Card key={m.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted", m.accent)}>
                    <m.icon className="h-[18px] w-[18px]" />
                  </span>
                  {m.limit !== null && pct > 80 && <Badge variant="warning" className="text-[10px]">{t("page.usage.nearLimit")}</Badge>}
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
            <TrendingUp className="h-4 w-4 text-primary" /> {t("page.usage.s0")}
          </CardTitle>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" /> {t("page.usage.s1")}
            </span>
            <Badge variant="secondary" className="text-[11px]">{t("page.usage.last14Days")}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <UsageChart data={trendData} labels={trendLabels} />
        </CardContent>
      </Card>
    </div>
  );
}
