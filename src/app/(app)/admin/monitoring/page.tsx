"use client";

import * as React from "react";
import {
  Activity, AlertTriangle, Bot, ChevronDown, Cpu, FileText, Gauge, ListTree, RefreshCw,
} from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UsageChart } from "@/components/app/usage-chart";
import { cn } from "@/lib/utils";

interface MonitoringData {
  startedAt: number;
  uptimeMs: number;
  requests: {
    total: number;
    errors: number;
    errorRate: number;
    perMinute: { ts: number; count: number; errors: number }[];
    latency: { count: number; avgMs: number | null; p50: number | null; p95: number | null; p99: number | null; maxMs: number | null };
  };
  rag: { calls: number; errors: number; latency: { avgMs: number | null; p95: number | null } };
  llm: {
    calls: number;
    errors: number;
    latency: { avgMs: number | null; p95: number | null };
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    byModel: { model: string; calls: number; errors: number; tokens: number; costUsd: number; avgMs: number | null }[];
  };
  doc: { calls: number; ok: number; failed: number; avgMs: number | null };
  agent: { runs: number; ok: number; failed: number; avgMs: number | null };
  traces: { traceId: string; name: string; status: string; start: number; durationMs: number }[];
  errors: { id: string; message: string; source: string; createdAt: number }[];
}

interface TraceSpan {
  spanId: string;
  name: string;
  kind: string;
  durationMs: number;
  status: string;
  parentId: string | null;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtUsd(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(3)}`;
}

const KIND_BADGE: Record<string, string> = {
  api: "bg-primary/10 text-primary",
  rag: "bg-sky-500/10 text-sky-500",
  llm: "bg-violet-500/10 text-violet-500",
  doc: "bg-emerald-500/10 text-emerald-500",
  agent: "bg-amber-500/10 text-amber-500",
};

export default function MonitoringPage() {
  const t = useT();
  const [data, setData] = React.useState<MonitoringData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [expandedTrace, setExpandedTrace] = React.useState<string | null>(null);
  const [traceSpans, setTraceSpans] = React.useState<TraceSpan[] | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/monitoring", { cache: "no-store" });
      if (!res.ok) return; // 403 for non-admins - AppShell redirects instead
      const d = await res.json();
      if (d?.requests && d?.llm) setData(d);
    } catch {
      /* dashboard is read-only - keep last snapshot */
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refresh(); }, [refresh]);

  async function openTrace(traceId: string) {
    if (expandedTrace === traceId) {
      setExpandedTrace(null);
      setTraceSpans(null);
      return;
    }
    setExpandedTrace(traceId);
    setTraceSpans(null);
    try {
      const d = await fetch(`/api/admin/monitoring/traces?id=${encodeURIComponent(traceId)}`, { cache: "no-store" }).then((r) => r.json());
      setTraceSpans(d.trace?.spans ?? []);
    } catch {
      setTraceSpans([]);
    }
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const qpsSeries = data.requests.perMinute.map((p) => p.count);
  const qpsLabels = data.requests.perMinute.map((p) => {
    const d = new Date(p.ts * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const lastMinute = data.requests.perMinute[data.requests.perMinute.length - 1];
  const llmTotalCost = data.llm.byModel.reduce((a, m) => a + m.costUsd, 0);

  const statCards = [
    { label: t("page.monitoring.s4"), value: String(lastMinute?.count ?? 0), icon: Gauge, sub: t("page.monitoring.s36") },
    { label: t("page.monitoring.s5"), value: String(data.requests.total), icon: Activity, sub: t("page.monitoring.s42") },
    { label: t("page.monitoring.s6"), value: `${data.requests.errorRate.toFixed(1)}%`, icon: AlertTriangle, sub: `${data.requests.errors} errors` },
    { label: t("page.monitoring.s7"), value: fmtMs(data.requests.latency.p50), icon: Cpu, sub: `${t("page.monitoring.s8")} ${fmtMs(data.requests.latency.p95)} · ${t("page.monitoring.s9")} ${fmtMs(data.requests.latency.p99)}` },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.monitoring.s0")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("page.monitoring.s1")} · {t("page.monitoring.s3")} {fmtUptime(data.uptimeMs)}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" /> {t("page.monitoring.s2")}
        </button>
      </div>

      {/* request SLI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <c.icon className="h-4 w-4" /> {c.label}
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{c.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* QPS chart */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("page.monitoring.s10")}</CardTitle>
          <Badge variant="secondary">{t("page.monitoring.s43")}</Badge>
        </CardHeader>
        <CardContent>
          <UsageChart data={qpsSeries.length >= 2 ? qpsSeries : [0, 0]} labels={qpsLabels} />
        </CardContent>
      </Card>

      {/* LLM monitor */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" />{t("page.monitoring.s11")}</CardTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t("page.monitoring.s17")}: <b className="tabular-nums">{data.llm.totalTokens.toLocaleString()}</b></span>
            <span>{t("page.monitoring.s18")}: <b className="tabular-nums">{fmtUsd(data.llm.costUsd)}</b></span>
            <span>{t("page.monitoring.s16")}: <b className="tabular-nums">{fmtMs(data.llm.latency.avgMs)}</b></span>
          </div>
        </CardHeader>
        <CardContent>
          {data.llm.byModel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("page.monitoring.s28")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">{t("page.monitoring.s12")}</th>
                    <th className="pb-2 font-medium">{t("page.monitoring.s13")}</th>
                    <th className="pb-2 font-medium">{t("page.monitoring.s14")}</th>
                    <th className="pb-2 font-medium">{t("page.monitoring.s15")}</th>
                    <th className="pb-2 font-medium">{t("page.monitoring.s16")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.llm.byModel.map((m) => (
                    <tr key={m.model} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-mono text-xs">{m.model}{m.errors > 0 && <span className="ml-1 text-destructive">({m.errors} err)</span>}</td>
                      <td className="py-2 tabular-nums">{m.calls}</td>
                      <td className="py-2 tabular-nums">{m.tokens.toLocaleString()}</td>
                      <td className="py-2 tabular-nums">{fmtUsd(m.costUsd)}</td>
                      <td className="py-2 tabular-nums">{fmtMs(m.avgMs)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="pt-2">{t("page.monitoring.s18")}</td>
                    <td className="pt-2 tabular-nums">{data.llm.calls}</td>
                    <td className="pt-2 tabular-nums">{data.llm.totalTokens.toLocaleString()}</td>
                    <td className="pt-2 tabular-nums">{fmtUsd(llmTotalCost)}</td>
                    <td className="pt-2 tabular-nums">{fmtMs(data.llm.latency.avgMs)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RAG / doc / agent cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4" />{t("page.monitoring.s19")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s22")}</span><span className="tabular-nums">{data.rag.calls}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s16")}</span><span className="tabular-nums">{fmtMs(data.rag.latency.avgMs)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s8")}</span><span className="tabular-nums">{fmtMs(data.rag.latency.p95)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s24")}</span><span className="tabular-nums text-destructive">{data.rag.errors}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" />{t("page.monitoring.s20")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s22")}</span><span className="tabular-nums">{data.doc.calls}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s23")}</span><span className="tabular-nums">{fmtMs(data.doc.avgMs)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">OK</span><span className="tabular-nums text-success">{data.doc.ok}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s24")}</span><span className="tabular-nums text-destructive">{data.doc.failed}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" />{t("page.monitoring.s21")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s22")}</span><span className="tabular-nums">{data.agent.runs}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s23")}</span><span className="tabular-nums">{fmtMs(data.agent.avgMs)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">OK</span><span className="tabular-nums text-success">{data.agent.ok}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{t("page.monitoring.s24")}</span><span className="tabular-nums text-destructive">{data.agent.failed}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* traces */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><ListTree className="h-4 w-4" />{t("page.monitoring.s25")}</CardTitle>
          <span className="text-xs text-muted-foreground">{t("page.monitoring.s26")}</span>
        </CardHeader>
        <CardContent className="space-y-1">
          {data.traces.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("page.monitoring.s40")}</p>
          ) : (
            data.traces.map((tr) => (
              <div key={tr.traceId} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => void openTrace(tr.traceId)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                >
                  <Badge variant={tr.status === "ok" ? "success" : "destructive"} className="w-12 justify-center">
                    {tr.status === "ok" ? "OK" : "ERR"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{tr.name}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {new Date(tr.start).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtMs(tr.durationMs)}</span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expandedTrace === tr.traceId && "rotate-180")} />
                </button>
                {expandedTrace === tr.traceId && (
                  <div className="border-t border-border px-3 py-2">
                    <p className="pb-1 font-mono text-[11px] text-muted-foreground">{t("page.monitoring.s39")}: {tr.traceId}</p>
                    {traceSpans === null ? (
                      <Skeleton className="h-16 rounded-lg" />
                    ) : traceSpans.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">{t("page.monitoring.s28")}</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {traceSpans.map((sp) => (
                          <li key={sp.spanId} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent/40">
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", KIND_BADGE[sp.kind] ?? "bg-muted text-muted-foreground")}>
                              {sp.kind}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono">{sp.name}</span>
                            {sp.status !== "ok" && <span className="text-destructive">ERR</span>}
                            <span className="tabular-nums text-muted-foreground">{fmtMs(sp.durationMs)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* errors */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />{t("page.monitoring.s27")}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {data.errors.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("page.monitoring.s41")}</p>
          ) : (
            data.errors.map((e) => (
              <div key={e.id} className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{e.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.source} · {new Date(e.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
