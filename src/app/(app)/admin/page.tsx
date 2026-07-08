"use client";
import * as React from "react";
import {
  Users, Activity, DollarSign, Database, HardDrive, Bot, MessagesSquare,
  ShieldBan, ShieldCheck, Search, Server, Cog, Loader2,
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

interface ProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}

import { cn } from "@/lib/utils";

const STATUS_VARIANT = {
  active: "success", banned: "destructive", trial: "warning",
} as const;
const STATUS_LABEL = { active: "正常", banned: "已封禁", trial: "试用中" } as const;
const KB_STATUS = { ready: "就绪", processing: "处理中", error: "异常" } as const;

export default function AdminPage() {
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [kbs, setKbs] = React.useState<KbMonitor[]>([]);
  const [config, setConfig] = React.useState<SystemConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [savingCfg, setSavingCfg] = React.useState(false);
  const [providers, setProviders] = React.useState<ProviderStatus[]>([]);

  const refresh = React.useCallback(async () => {
    const [o, u, k, c] = await Promise.all([
      fetch("/api/admin", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/kbs", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/config", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setOverview(o); setUsers(u.users ?? []); setKbs(k.kbs ?? []); setConfig(c);
    setProviders(c.providers ?? []);
    setLoading(false);
  }, []);
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
    await fetch("/api/admin/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    refresh();
    setSavingCfg(false);
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
    { icon: Users, label: "总用户数", value: stats.totalUsers.toLocaleString(), accent: "text-primary" },
    { icon: Activity, label: "30 天活跃", value: stats.activeUsers30d.toLocaleString(), accent: "text-emerald-500" },
    { icon: DollarSign, label: "月收入", value: `¥${stats.monthlyRevenue.toLocaleString()}`, accent: "text-amber-500" },
    { icon: Database, label: "知识库总数", value: stats.totalKbs.toLocaleString(), accent: "text-sky-500" },
    { icon: MessagesSquare, label: "本月问答", value: stats.qaThisMonth.toLocaleString(), accent: "text-violet-500" },
    { icon: Bot, label: "本月 Agent", value: stats.agentTasksThisMonth.toLocaleString(), accent: "text-pink-500" },
    { icon: HardDrive, label: "存储用量", value: `${stats.storageUsedGb} GB`, accent: "text-orange-500" },
    { icon: Database, label: "文档总数", value: stats.totalDocs.toLocaleString(), accent: "text-teal-500" },
  ];

  const maxRev = Math.max(...overview.revenueTrend.map((r) => r.revenue));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="text-[10px]">Owner 专属</Badge>
        <h1 className="text-2xl font-bold tracking-tight">管理后台</h1>
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
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> 收入趋势</CardTitle>
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
              <span className="flex items-center gap-2"><Users className="h-4 w-4" /> 用户管理</span>
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索用户…" className="h-8 pl-8 text-xs" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>套餐</TableHead>
                  <TableHead>知识库</TableHead>
                  <TableHead>最近活跃</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
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
                      <Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge>
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
            <CardTitle className="flex items-center gap-2"><Cog className="h-4 w-4" /> 系统配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">默认对话模型</Label>
              <Input value={config.defaultModel} onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">嵌入模型</Label>
              <Input value={config.embeddingModel} onChange={(e) => setConfig({ ...config, embeddingModel: e.target.value })} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">限流（次/分）</Label>
                <Input type="number" value={config.rateLimitPerMin} onChange={(e) => setConfig({ ...config, rateLimitPerMin: +e.target.value })} className="h-8 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">上传上限（MB）</Label>
                <Input type="number" value={config.maxUploadMb} onChange={(e) => setConfig({ ...config, maxUploadMb: +e.target.value })} className="h-8 text-sm" />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">允许注册</p>
                <p className="text-xs text-muted-foreground">关闭后新用户无法注册</p>
              </div>
              <Switch checked={config.allowSignup} onCheckedChange={(v) => patchConfig({ allowSignup: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">维护模式</p>
                <p className="text-xs text-muted-foreground">开启后用户看到维护页面</p>
              </div>
              <Switch checked={config.maintenanceMode} onCheckedChange={(v) => patchConfig({ maintenanceMode: v })} />
            </div>
            <Button size="sm" className="w-full" onClick={() => patchConfig(config)} disabled={savingCfg}>
              {savingCfg && <Loader2 className="h-4 w-4 animate-spin" />} 保存配置
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> 知识库监控</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>知识库</TableHead>
                <TableHead>所有者</TableHead>
                <TableHead>文档数</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>查询数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
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
                      {KB_STATUS[kb.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(kb.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
