"use client";

// P7-1 developer portal: quick start (SDK snippets), webhook subscriptions
// management, API usage stats. The 集成 tab (P7-2) lists third-party
// integrations. All copy goes through t() - see page.developer.* keys.

import * as React from "react";
import { Plus, Trash2, Send, ExternalLink, FileCode2, Plug, BarChart3 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { UsageChart } from "@/components/app/usage-chart";
import { DeveloperIntegrations } from "@/components/app/developer-integrations";

const EVENTS = ["kb.ready", "agent.completed", "usage.alert"] as const;

interface WebhookSub {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  failures: number;
  lastError: string | null;
}

interface Delivery {
  id: string;
  subscriptionId: string;
  event: string;
  status: number | string;
  ts: number;
  latencyMs: number;
  detail?: string;
}

interface CallLog {
  id: string;
  keyId: string;
  endpoint: string;
  method: string;
  status: number;
  ts: number;
  latencyMs: number;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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

export default function DeveloperPage() {
  const t = useT();
  const [tab, setTab] = React.useState("quickstart");
  const [loading, setLoading] = React.useState(true);
  const [webhooks, setWebhooks] = React.useState<WebhookSub[]>([]);
  const [deliveries, setDeliveries] = React.useState<Delivery[]>([]);
  const [logs, setLogs] = React.useState<CallLog[]>([]);
  const [hourBuckets, setHourBuckets] = React.useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });

  // webhook create form
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [events, setEvents] = React.useState<string[]>(["kb.ready"]);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/v1/webhooks", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/api-keys/logs", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([wh, lg]) => {
        setWebhooks(wh.webhooks ?? []);
        setDeliveries(wh.deliveries ?? []);
        setLogs(lg.logs ?? []);
        setHourBuckets(bucketByHour(lg.logs ?? []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function createWebhook() {
    setError("");
    if (!url.trim()) {
      setError(t("page.developer.s26"));
      return;
    }
    if (events.length === 0) {
      setError(t("page.developer.s27"));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, secret, events }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("page.developer.s25"));
        return;
      }
      setCreateOpen(false);
      setName(""); setUrl(""); setSecret(""); setEvents(["kb.ready"]);
      load();
    } catch {
      setError(t("page.developer.s25"));
    } finally {
      setCreating(false);
    }
  }

  async function toggleWebhook(sub: WebhookSub) {
    await fetch(`/api/v1/webhooks/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !sub.active }),
    });
    load();
  }

  async function deleteWebhook(id: string) {
    await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
    load();
  }

  async function testWebhook(id: string) {
    await fetch(`/api/v1/webhooks/${id}/test`, { method: "POST" });
    load();
  }

  // ── usage stats: bucket call logs by hour (last 24h) ────────────────────
  const totalCalls = logs.length;
  const avgLatency = logs.length
    ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / logs.length)
    : 0;
  const byEndpoint = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) m.set(l.endpoint, (m.get(l.endpoint) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs]);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="quickstart" value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="quickstart">
            <FileCode2 className="mr-1.5 h-4 w-4" />
            {t("page.developer.s0")}
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            <Send className="mr-1.5 h-4 w-4" />
            {t("page.developer.s1")}
          </TabsTrigger>
          <TabsTrigger value="usage">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            {t("page.developer.s2")}
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Plug className="mr-1.5 h-4 w-4" />
            {t("page.developer.s3")}
          </TabsTrigger>
        </TabsList>

        {/* ── 快速开始 ─────────────────────────────────────────────────── */}
        <TabsContent value="quickstart" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("page.developer.s4")}</CardTitle>
              <CardDescription>
                {t("page.developer.s5")}
                <a href="/docs" target="_blank" className="ml-1 inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline">
                  {t("page.developer.s6")} <ExternalLink className="h-3 w-3" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="mb-2 text-sm font-medium text-muted-foreground">JavaScript</p>
                <pre className="overflow-x-auto text-xs leading-relaxed">
                  {`import { KnowledgeAI } from "kai-sdk.mjs";

const kai = new KnowledgeAI({ apiKey: "kai_sk_...", baseUrl: "http://localhost:3000" });
const { kbs } = await kai.listKnowledgeBases();
await kai.ask(kbs[0].id, ${JSON.stringify(t("page.developer.s71"))}, {
  onToken: (text) => process.stdout.write(text),
});`}
                </pre>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="mb-2 text-sm font-medium text-muted-foreground">Python</p>
                <pre className="overflow-x-auto text-xs leading-relaxed">
                  {`from kai_sdk import KnowledgeAI

kai = KnowledgeAI(api_key="kai_sk_...", base_url="http://localhost:3000")
print(kai.list_knowledge_bases())
done = kai.ask("kb_xxx", "${t("page.developer.s71")}", on_token=lambda t: print(t, end=""))`}
                </pre>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="mb-2 text-sm font-medium text-muted-foreground">Go</p>
                <pre className="overflow-x-auto text-xs leading-relaxed">
                  {`client := kai.New("kai_sk_...", "http://localhost:3000")
kbs, _ := client.ListKnowledgeBases(ctx)
done, _ := client.Ask(ctx, "kb_xxx", "${t("page.developer.s71")}", nil)`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhook 管理 ─────────────────────────────────────────────── */}
        <TabsContent value="webhooks" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>{t("page.developer.s7")}</CardTitle>
                <CardDescription>{t("page.developer.s8")}</CardDescription>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    {t("page.developer.s9")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("page.developer.s9")}</DialogTitle>
                    <DialogDescription>{t("page.developer.s10")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>{t("page.developer.s11")}</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("page.developer.s72")} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("page.developer.s12")}</Label>
                      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/kai" />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("page.developer.s13")}</Label>
                      <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t("page.developer.s14")} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("page.developer.s15")}</Label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {EVENTS.map((ev) => (
                          <label key={ev} className="flex cursor-pointer items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={events.includes(ev)}
                              onChange={(e) =>
                                setEvents((prev) =>
                                  e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)
                                )
                              }
                            />
                            <code className="text-xs">{ev}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("page.developer.s16")}</Button>
                    <Button onClick={createWebhook} disabled={creating}>
                      {creating ? t("page.developer.s17") : t("page.developer.s18")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : webhooks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("page.developer.s19")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("page.developer.s11")}</TableHead>
                      <TableHead>{t("page.developer.s12")}</TableHead>
                      <TableHead>{t("page.developer.s15")}</TableHead>
                      <TableHead>{t("page.developer.s20")}</TableHead>
                      <TableHead className="text-right">{t("page.developer.s21")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.map((sub) => (
                      <TableRow key={sub.id}>
                        <TableCell>
                          <div className="font-medium">{sub.name}</div>
                          <div className="text-xs text-muted-foreground">{sub.id}</div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">{sub.url}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {sub.events.map((ev) => (
                              <Badge key={ev} variant="outline" className="font-mono text-[10px]">{ev}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {sub.failures > 0 ? (
                            <Badge variant="destructive">
                              {t("page.developer.s22")} {sub.failures}
                              {sub.lastError ? ` · ${sub.lastError}` : ""}
                            </Badge>
                          ) : sub.active ? (
                            <Badge variant="success">{t("page.developer.s23")}</Badge>
                          ) : (
                            <Badge variant="secondary">{t("page.developer.s24")}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Switch checked={sub.active} onCheckedChange={() => toggleWebhook(sub)} />
                            <Button variant="outline" size="sm" onClick={() => testWebhook(sub.id)} title={t("page.developer.s28")}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteWebhook(sub.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {deliveries.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">{t("page.developer.s29")}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("page.developer.s30")}</TableHead>
                        <TableHead>{t("page.developer.s31")}</TableHead>
                        <TableHead>{t("page.developer.s32")}</TableHead>
                        <TableHead>{t("page.developer.s33")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deliveries.slice(0, 15).map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.event}</TableCell>
                          <TableCell>
                            {d.status === "dead" ? (
                              <Badge variant="destructive">{t("page.developer.s22")}</Badge>
                            ) : d.status === "error" ? (
                              <Badge variant="destructive">{d.detail ?? "error"}</Badge>
                            ) : (
                              <Badge variant="success">{d.status}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtTime(d.ts)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{d.latencyMs}ms</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 用量统计 ─────────────────────────────────────────────────── */}
        <TabsContent value="usage" className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("page.developer.s34")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{totalCalls}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("page.developer.s35")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{webhooks.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("page.developer.s36")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{avgLatency}ms</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("page.developer.s37")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{logs.length > 0 ? new Date(logs[0].ts).toLocaleDateString() : "-"}</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("page.developer.s38")}</CardTitle>
              <CardDescription>{t("page.developer.s39")}</CardDescription>
            </CardHeader>
            <CardContent>
              <UsageChart data={hourBuckets.data} labels={hourBuckets.labels} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("page.developer.s40")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("page.developer.s41")}</TableHead>
                    <TableHead className="text-right">{t("page.developer.s42")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byEndpoint.map(([endpoint, count]) => (
                    <TableRow key={endpoint}>
                      <TableCell className="font-mono text-xs">{endpoint}</TableCell>
                      <TableCell className="text-right tabular-nums">{count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 集成（P7-2） ────────────────────────────────────────────── */}
        <TabsContent value="integrations">
          <DeveloperIntegrations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
