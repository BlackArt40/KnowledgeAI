"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import { clientLog } from "@/lib/obs/log-browser";
import {
  Users, Activity, DollarSign, Database, HardDrive, Bot, MessagesSquare,
  ShieldBan, ShieldCheck, Search, Server, Cog, Loader2, Gauge, ShieldAlert,
  ScrollText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import type { AdminOverview, AdminUser, KbMonitor, SystemConfig } from "@/lib/admin/types";
import type { RateLimitStat } from "@/lib/rate-limit";
import type { ProviderStatus } from "@/lib/config";
import type { AuditEvent } from "@/lib/security/audit";

import { cn } from "@/lib/utils";

const STATUS_VARIANT = {
  active: "success", banned: "destructive",
} as const;
function statusLabel(t: (k: string) => string) {
  return { active: t("page.admin.s42"), banned: t("page.admin.s43") } as const;
}
function kbStatusLabel(t: (k: string) => string) {
  return { ready: t("page.admin.s44"), processing: t("page.admin.s45"), error: t("page.admin.s46") } as const;
}

interface RateLimitDashboard {
  mode: "memory" | "redis";
  limits: { base: number; anon: number; key: number; kb: number };
  live: RateLimitStat[];
  recent: RateLimitStat[];
}

// P3-3: dimension badges for the rate-limit dashboard
function rlKind(t: (k: string) => string): Record<RateLimitStat["kind"], { label: string; variant: "default" | "secondary" | "outline" | "warning" | "success" | "destructive" }> {
  return {
    ip: { label: "IP", variant: "secondary" },
    user: { label: t("page.admin.s4"), variant: "default" },
    apikey: { label: "API Key", variant: "outline" },
    kb: { label: t("page.admin.s6"), variant: "warning" },
    integration: { label: t("page.admin.s48"), variant: "secondary" },
    other: { label: t("page.admin.s47"), variant: "outline" },
  };
}

function rlResetIn(s: RateLimitStat): string {
  const secs = Math.max(0, Math.ceil((s.resetAt - Date.now()) / 1000));
  return secs <= 0 ? "已重置" : `${secs}s`;
}

export default function AdminPage() {
  const t = useT();
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [kbs, setKbs] = React.useState<KbMonitor[]>([]);
  const [config, setConfig] = React.useState<SystemConfig | null>(null);
  const [providers, setProviders] = React.useState<ProviderStatus[]>([]);
  const [ratelimit, setRatelimit] = React.useState<RateLimitDashboard | null>(null);
  const [audit, setAudit] = React.useState<{ audit: AuditEvent[]; total: number; chainValid: boolean } | null>(null);
  const [auditAction, setAuditAction] = React.useState("");
  const [auditActor, setAuditActor] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [savingCfg, setSavingCfg] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [o, u, k, c, rl, au] = await Promise.all([
      fetch("/api/admin", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/kbs", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/config", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/ratelimit", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/audit", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setOverview(o); setUsers(u.users ?? []); setKbs(k.kbs ?? []); setConfig(c);
    setProviders(c.providers ?? []); setRatelimit(rl); setAudit(au);
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refresh(); }, [refresh]);

  async function setUserStatus(id: string, status: "active" | "banned") {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function patchConfig(patch: Partial<SystemConfig>) {
    setSavingCfg(true);
    const res = await fetch("/api/admin/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // PATCH failed: refresh from server to discard the optimistic update so
      // the UI doesn't display a change that was never persisted.
      clientLog.error({ status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) }, "patchConfig failed");
    }
    await refresh();
    setSavingCfg(false);
  }

  const ROLE_OPTIONS: { role: string; label: string }[] = [
    { role: "owner", label: "Owner" },
    { role: "admin", label: "Admin" },
    { role: "editor", label: "Editor" },
    { role: "viewer", label: "Viewer" },
  ];

  function toggle2FARole(role: string, on: boolean) {
    if (!config) return;
    const current = new Set(config.required2FARoles);
    if (on) current.add(role); else current.delete(role);
    const next = ROLE_OPTIONS.map((r) => r.role).filter((r) => current.has(r));
    setConfig({ ...config, required2FARoles: next });
    void patchConfig({ required2FARoles: next });
  }

  // P3-4: filtered audit query (action / actor substrings) - the tamper-evident
  // hash chain status is reported by the API alongside the entries.
  async function searchAudit() {
    const qs = new URLSearchParams();
    if (auditAction) qs.set("action", auditAction);
    if (auditActor) qs.set("actor", auditActor);
    const r = await fetch(`/api/admin/audit?${qs.toString()}`, { cache: "no-store" });
    setAudit(await r.json());
  }

  if (loading || !overview || !config) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const { stats } = overview;
  const filtered = users.filter((u) =>
    u.name.includes(search) || u.email.includes(search) || u.id.includes(search)
  );

  const statCards = [
    { icon: Users, label: t("page.admin.s49"), value: stats.totalUsers.toLocaleString(), accent: "text-primary" },
    { icon: Activity, label: t("page.admin.s50"), value: stats.activeUsers30d.toLocaleString(), accent: "text-emerald-500" },
    { icon: DollarSign, label: "月收入", value: `¥${stats.monthlyRevenue.toLocaleString()}`, accent: "text-amber-500" },
    { icon: Database, label: t("page.admin.s52"), value: stats.totalKbs.toLocaleString(), accent: "text-sky-500" },
    { icon: MessagesSquare, label: t("page.admin.s53"), value: stats.qaThisMonth.toLocaleString(), accent: "text-violet-500" },
    { icon: Bot, label: t("page.admin.s54"), value: stats.agentTasksThisMonth.toLocaleString(), accent: "text-pink-500" },
    { icon: HardDrive, label: "存储用量", value: `${stats.storageUsedGb} GB`, accent: "text-orange-500" },
    { icon: Database, label: t("page.admin.s56"), value: stats.totalDocs.toLocaleString(), accent: "text-teal-500" },
  ];

  const maxRev = Math.max(...overview.revenueTrend.map((r) => r.revenue));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="text-[10px]">{t("page.admin.s0")}</Badge>
        <h1 className="text-2xl font-bold tracking-tight">{t("page.admin.s1")}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <s.icon className={cn("h-4 w-4", s.accent)} />
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" />{t("page.admin.s0")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-3">
            {overview.revenueTrend.map((r) => (
              <div key={r.month} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-brand-gradient transition-all hover:opacity-80"
                    style={{ height: `${(r.revenue / maxRev) * 100}%` }}
                    title={`¥${r.revenue.toLocaleString()}`}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{r.month}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Users className="h-4 w-4" />{t("page.admin.s1")}</span>
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("page.admin.s57")} className="h-8 pl-8 text-xs" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("page.admin.s4")}</TableHead>
                  <TableHead>{t("page.admin.s5")}</TableHead>
                  <TableHead>{t("page.admin.s6")}</TableHead>
                  <TableHead>{t("page.admin.s7")}</TableHead>
                  <TableHead>{t("page.admin.s8")}</TableHead>
                  <TableHead className="text-right">{t("page.admin.s9")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 12).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.plan === "enterprise" ? "default" : u.plan === "pro" ? "secondary" : "outline"}>{u.plan}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{u.kbs}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRelative(u.lastActive)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[u.status]}>{statusLabel(t)[u.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {u.status === "banned" ? (
                        <Button size="sm" variant="ghost" className="h-7 text-success hover:text-success" onClick={() => setUserStatus(u.id, "active")}>
                          <ShieldCheck className="h-3.5 w-3.5" /> 解封
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => setUserStatus(u.id, "banned")}>
                          <ShieldBan className="h-3.5 w-3.5" /> 封禁
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cog className="h-4 w-4" />{t("page.admin.s2")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">{t("page.admin.s11")}</Label>
              <Input value={config.defaultModel} onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t("page.admin.s12")}</Label>
              <Input value={config.embeddingModel} onChange={(e) => setConfig({ ...config, embeddingModel: e.target.value })} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">{t("page.admin.s13")}<span className="text-muted-foreground">{t("page.admin.s14")}</span></Label>
                <Input type="number" value={config.rateLimitPerMin} readOnly className="h-8 cursor-not-allowed text-sm opacity-60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">{t("page.admin.s15")}</Label>
                <Input type="number" value={config.maxUploadMb} onChange={(e) => setConfig({ ...config, maxUploadMb: +e.target.value })} className="h-8 text-sm" />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("page.admin.s16")}</p>
                <p className="text-xs text-muted-foreground">{t("page.admin.s17")}</p>
              </div>
              <Switch checked={config.allowSignup} onCheckedChange={(v) => patchConfig({ allowSignup: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("page.admin.s18")}</p>
                <p className="text-xs text-muted-foreground">{t("page.admin.s19")}</p>
              </div>
              <Switch checked={config.maintenanceMode} onCheckedChange={(v) => patchConfig({ maintenanceMode: v })} />
            </div>
            <Separator />
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t("page.admin.s20")}</p>
                <p className="text-xs text-muted-foreground">{t("page.admin.s21")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <label key={r.role} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <span className="text-sm">{r.label}</span>
                    <Switch
                      checked={config.required2FARoles.includes(r.role)}
                      onCheckedChange={(v) => toggle2FARole(r.role, v)}
                    />
                  </label>
                ))}
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={() => patchConfig(config)} disabled={savingCfg}>
              {savingCfg && <Loader2 className="h-4 w-4 animate-spin" />} 保存配置
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" />{t("page.admin.s3")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("page.admin.s6")}</TableHead>
                <TableHead>{t("page.admin.s23")}</TableHead>
                <TableHead>{t("page.admin.s24")}</TableHead>
                <TableHead>{t("page.admin.s25")}</TableHead>
                <TableHead>{t("page.admin.s26")}</TableHead>
                <TableHead>{t("page.admin.s8")}</TableHead>
                <TableHead>{t("page.admin.s27")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kbs.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell className="font-medium">{kb.name}</TableCell>
                  <TableCell className="text-muted-foreground">{kb.owner}</TableCell>
                  <TableCell className="tabular-nums">{kb.docs}</TableCell>
                  <TableCell className="text-muted-foreground">{kb.size}</TableCell>
                  <TableCell className="tabular-nums">{kb.queries.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={kb.status === "ready" ? "success" : kb.status === "processing" ? "warning" : "destructive"}>
                      {kbStatusLabel(t)[kb.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(kb.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Gauge className="h-4 w-4" />{t("page.admin.s4")}</span>
              <Badge variant={ratelimit?.mode === "redis" ? "success" : "secondary"}>
                {ratelimit?.mode === "redis" ? t("page.admin.s58") : t("page.admin.s59")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ratelimit && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  [t("page.admin.s4"), ratelimit.limits.base],
                  [t("page.admin.s60"), ratelimit.limits.anon],
                  ["API Key", ratelimit.limits.key],
                  [t("page.admin.s6"), ratelimit.limits.kb],
                ] as const).map(([label, v]) => (
                  <div key={label} className="rounded-lg border border-border p-2 text-center">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="text-lg font-bold tabular-nums">{v}<span className="text-xs font-normal text-muted-foreground">{t("page.admin.s29")}</span></div>
                  </div>
                ))}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("page.admin.s30")}</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="text-right">{t("page.admin.s31")}</TableHead>
                  <TableHead className="text-right">{t("page.admin.s32")}</TableHead>
                  <TableHead className="text-right">{t("page.admin.s33")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ratelimit?.live ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      暂无限流记录（API 请求产生流量后自动出现）
                    </TableCell>
                  </TableRow>
                ) : (
                  (ratelimit?.live ?? []).slice(0, 12).map((s) => (
                    <TableRow key={s.key}>
                      <TableCell><Badge variant={rlKind(t)[s.kind].variant}>{rlKind(t)[s.kind].label}</Badge></TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground" title={s.key}>{s.key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.count}<span className="text-muted-foreground">/{s.limit}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.remaining <= 0 ? "destructive" : s.remaining / s.limit < 0.2 ? "warning" : "secondary"}>
                          {s.remaining}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{rlResetIn(s)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <Button size="sm" variant="outline" className="w-full" onClick={refresh}>
              <Loader2 className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" />{t("page.admin.s5")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{p.label}</span>
                      <Badge variant={p.enabled ? "success" : "secondary"}>
                        {p.enabled ? t("page.admin.s61") : t("page.admin.s62")}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={p.detail}>{p.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><ScrollText className="h-4 w-4" />{t("page.admin.s6")}</span>
            <div className="flex items-center gap-2">
              <Badge variant={audit?.chainValid ? "success" : "destructive"}>
                {audit?.chainValid ? t("page.admin.s63") : t("page.admin.s64")}
              </Badge>
              <Badge variant="secondary">共 {audit?.total ?? 0} 条</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              placeholder={t("page.admin.s65")}
              className="h-8 w-56 text-xs"
            />
            <Input
              value={auditActor}
              onChange={(e) => setAuditActor(e.target.value)}
              placeholder={t("page.admin.s66")}
              className="h-8 w-44 text-xs"
            />
            <Button size="sm" variant="outline" onClick={searchAudit}>{t("page.admin.s36")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAuditAction(""); setAuditActor(""); refresh(); }}>{t("page.admin.s33")}</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("page.admin.s37")}</TableHead>
                <TableHead>{t("page.admin.s38")}</TableHead>
                <TableHead>{t("page.admin.s39")}</TableHead>
                <TableHead>{t("page.admin.s40")}</TableHead>
                <TableHead>{t("page.admin.s41")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit?.audit ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    暂无审计记录
                  </TableCell>
                </TableRow>
              ) : (
                (audit?.audit ?? []).slice(0, 30).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(e.createdAt)}</TableCell>
                    <TableCell className="text-xs">{e.actor}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[10px]">{e.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.target}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={e.detail}>{e.detail}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
