"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import {
  KeyRound, Plus, Copy, Check, Trash2, Power, CheckCircle2, XCircle,
  Terminal, BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { UsageChart } from "@/components/app/usage-chart";
import { SCOPES, type ApiKey, type CallLog, type KeyStatus } from "@/lib/apikeys/types";
import { cn } from "@/lib/utils";

/** P7-1: bucket call logs by hour (last 24h) for the usage chart. */
function bucketByHour(logs: CallLog[]): { labels: string[]; data: number[] } {
  const now = Date.now();
  const labels: string[] = [];
  const data: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - i * 3600_000;
    const end = start + 3600_000;
    labels.push(i % 3 === 0 ? new Date(start).getHours() + "h" : "");
    data.push(logs.filter((l) => l.ts >= start && l.ts < end).length);
  }
  return { labels, data };
}

export default function ApiKeysPage() {
  const t = useT();
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [logs, setLogs] = React.useState<CallLog[]>([]);
  const [hourly, setHourly] = React.useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newKey, setNewKey] = React.useState<ApiKey | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>(["kb:read", "chat:read"]);

  const refresh = React.useCallback(async () => {
    const [k, l] = await Promise.all([
      fetch("/api/api-keys", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/api-keys/logs", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setKeys(k.keys ?? []);
    setLogs(l.logs ?? []);
    // P7-1: bucket call logs by hour (last 24h) for the usage chart.
    setHourly(bucketByHour(l.logs ?? []));
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refresh(); }, [refresh]);

  // P7-1: bucket call logs by hour (last 24h) for the usage chart.
  function toggleScope(id: string) {
    setScopes((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      const { key } = await res.json();
      setNewKey(key);
      setName(""); setScopes(["kb:read", "chat:read"]);
      refresh();
    } finally { setCreating(false); }
  }

  async function toggle(id: string, status: KeyStatus) {
    await fetch(`/api/api-keys/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    refresh();
  }

  function copySecret() {
    if (!newKey) return;
    navigator.clipboard?.writeText(newKey.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const totalCalls = keys.reduce((a, k) => a + k.calls, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.api-keys.s0")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建密钥以通过 API 访问知识库、问答与 Agent 服务。共 {keys.length} 个密钥，累计调用 {totalCalls.toLocaleString()} 次。
          </p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="gradient"><Plus className="h-4 w-4" />{t("page.api-keys.s0")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("page.api-keys.s2")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("page.api-keys.s3")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("page.api-keys.s16")} />
              </div>
              <div className="space-y-2">
                <Label>{t("page.api-keys.s4")}</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SCOPES.map((s) => (
                    <label key={s.id} className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors",
                      scopes.includes(s.id) ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-accent"
                    )}>
                      <input type="checkbox" checked={scopes.includes(s.id)} onChange={() => toggleScope(s.id)} className="accent-primary" />
                      <span><span className="font-mono text-xs">{s.id}</span> · {s.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={creating}>
                {creating ? t("page.api-keys.s17") : t("page.api-keys.s1")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Secret reveal dialog */}
      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> 密钥已创建
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              请立即复制并妥善保管此密钥，关闭后将无法再次查看完整内容。
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
              <code className="flex-1 break-all font-mono text-xs">{newKey?.secret}</code>
              <Button size="sm" variant="outline" onClick={copySecret}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("page.api-keys.s18") : t("page.api-keys.s19")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>{t("page.api-keys.s5")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />{t("page.api-keys.s1")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("page.api-keys.s7")}</TableHead>
                <TableHead>{t("page.api-keys.s8")}</TableHead>
                <TableHead>{t("page.api-keys.s9")}</TableHead>
                <TableHead>{t("page.api-keys.s10")}</TableHead>
                <TableHead>{t("page.api-keys.s11")}</TableHead>
                <TableHead>{t("page.api-keys.s12")}</TableHead>
                <TableHead className="text-right">{t("page.api-keys.s13")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell><code className="font-mono text-xs text-muted-foreground">{k.prefix}</code></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{k.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{k.lastUsed ? formatRelative(k.lastUsed) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={k.status === "active" ? "success" : "destructive"}>
                      {k.status === "active" ? t("page.api-keys.s20") : t("page.api-keys.s21")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggle(k.id, k.status === "active" ? "disabled" : "active")} title={k.status === "active" ? t("page.api-keys.s22") : t("page.api-keys.s20")}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(k.id)} title={t("page.api-keys.s23")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* P7-1: API 调用量时序（按小时，基于 CallLog） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" />{t("page.api-keys.s26")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageChart data={hourly.data} labels={hourly.labels} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Terminal className="h-4 w-4" />{t("page.api-keys.s2")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="curl">
              <TabsList>
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="python">Python</TabsTrigger>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
              </TabsList>
              <TabsContent value="curl">
                <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed"><code>{`curl -X POST https://api.knowledgeai.dev/api/chat \\
  -H "Authorization: Bearer kai_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"kb":"kb_1","query":"产品有哪些功能？"}'`}</code></pre>
              </TabsContent>
              <TabsContent value="python">
                <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed"><code>{`import requests

resp = requests.post(
    "https://api.knowledgeai.dev/api/chat",
    headers={"Authorization": "Bearer kai_sk_..."},
    json={"kb": "kb_1", "query": t("page.api-keys.s24")},
)
print(resp.json())`}</code></pre>
              </TabsContent>
              <TabsContent value="js">
                <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed"><code>{`const res = await fetch("https://api.knowledgeai.dev/api/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer kai_sk_...",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ kb: "kb_1", query: t("page.api-keys.s24") }),
});
const data = await res.json();`}</code></pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("page.api-keys.s15")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <div className="space-y-1.5">
              {logs.slice(0, 20).map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50">
                  {l.status === 200 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="font-mono text-muted-foreground">{l.method}</span>
                  <span className="flex-1 truncate">{l.endpoint}</span>
                  <span className="tabular-nums text-muted-foreground">{l.status}</span>
                  <span className="tabular-nums text-muted-foreground">{l.latencyMs}ms</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
