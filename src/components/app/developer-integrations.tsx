"use client";

// P7-2 集成市场 tab: Embeddable Widget 片段生成 + 群机器人管理 + Chrome
// 扩展 + n8n/Zapier 文档。所有文案走 t()（page.developer.s44+）。

import * as React from "react";
import { Plus, Trash2, Copy, Check, Power, Bot, Globe, Puzzle, Workflow } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const PLATFORMS = ["slack", "feishu", "dingtalk", "test"] as const;

interface BotBinding {
  id: string;
  name: string;
  platform: string;
  kbId: string;
  kbName?: string;
  active: boolean;
  calls: number;
  createdAt: number;
}

export function DeveloperIntegrations() {
  const t = useT();
  const [bots, setBots] = React.useState<BotBinding[]>([]);
  const [kbs, setKbs] = React.useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState("");

  // widget snippet form
  const [widgetKey, setWidgetKey] = React.useState("");
  const [widgetKb, setWidgetKb] = React.useState("");

  // bot create form
  const [createOpen, setCreateOpen] = React.useState(false);
  const [botName, setBotName] = React.useState("");
  const [botPlatform, setBotPlatform] = React.useState<string>("slack");
  const [botKb, setBotKb] = React.useState("");
  const [botToken, setBotToken] = React.useState<{ token: string; id: string } | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/v1/integrations/bot", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/v1/knowledge-bases", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([b, k]) => {
        setBots(b.bots ?? []);
        setKbs(k.kbs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function copy(text: string, tag: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(""), 1500);
  }

  async function createBot() {
    setError("");
    if (!botKb) {
      setError(t("page.developer.s59"));
      return;
    }
    try {
      const res = await fetch("/api/v1/integrations/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: botName, platform: botPlatform, kbId: botKb }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("page.developer.s25"));
        return;
      }
      setBotToken({ token: data.bot.token, id: data.bot.id });
      setCreateOpen(false);
      setBotName(""); setBotKb("");
      load();
    } catch {
      setError(t("page.developer.s25"));
    }
  }

  async function toggleBot(bot: BotBinding) {
    await fetch(`/api/v1/integrations/bot/${bot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !bot.active }),
    });
    load();
  }

  async function deleteBot(id: string) {
    await fetch(`/api/v1/integrations/bot/${id}`, { method: "DELETE" });
    load();
  }

  const widgetSnippet = `<!-- ${t("page.developer.s73")} -->
<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget/kai-widget.js"></script>
<script>
  KnowledgeAIWidget.init({
    endpoint: "${typeof window !== "undefined" ? window.location.origin : ""}",
    apiKey: "${widgetKey}",
    kbId: "${widgetKb}",
    title: "${t("page.developer.s67")}",
  });
</script>`;

  return (
    <div className="space-y-4">
      {/* ── Embeddable Widget ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {t("page.developer.s44")}
          </CardTitle>
          <CardDescription>{t("page.developer.s45")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("page.developer.s46")}</Label>
              <Input
                value={widgetKey}
                onChange={(e) => setWidgetKey(e.target.value)}
                placeholder="kai_sk_...（chat:read）"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("page.developer.s47")}</Label>
              <Select value={widgetKb} onValueChange={setWidgetKb}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("page.developer.s48")} />
                </SelectTrigger>
                <SelectContent>
                  {kbs.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative rounded-lg border border-border bg-muted/40 p-3">
            <pre className="overflow-x-auto text-xs leading-relaxed">{widgetSnippet}</pre>
            <Button
              variant="outline" size="sm" className="absolute right-2 top-2"
              onClick={() => copy(widgetSnippet, "widget")}
            >
              {copied === "widget" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "widget" ? t("page.developer.s50") : t("page.developer.s49")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("page.developer.s51")}</p>
        </CardContent>
      </Card>

      {/* ── 群机器人 ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              {t("page.developer.s52")}
            </CardTitle>
            <CardDescription>{t("page.developer.s53")}</CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                {t("page.developer.s54")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("page.developer.s54")}</DialogTitle>
                <DialogDescription>{t("page.developer.s55")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>{t("page.developer.s11")}</Label>
                  <Input value={botName} onChange={(e) => setBotName(e.target.value)} placeholder={t("page.developer.s68")} />
                </div>
                <div className="space-y-1">
                  <Label>{t("page.developer.s56")}</Label>
                  <Select value={botPlatform} onValueChange={setBotPlatform}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("page.developer.s47")}</Label>
                  <Select value={botKb} onValueChange={setBotKb}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("page.developer.s48")} />
                    </SelectTrigger>
                    <SelectContent>
                      {kbs.map((kb) => (
                        <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("page.developer.s16")}</Button>
                <Button onClick={createBot}>{t("page.developer.s18")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4">
          {botToken && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 font-medium">{t("page.developer.s57")}</p>
              <code className="break-all text-xs">{botToken.token}</code>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{t("page.developer.s58")}:</span>
                <code className="break-all">{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/integrations/bot/m/{botToken.token}</code>
              </div>
              <Button
                variant="outline" size="sm" className="mt-2"
                onClick={() => copy(botToken.token, "bottoken")}
              >
                {copied === "bottoken" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "bottoken" ? t("page.developer.s50") : t("page.developer.s49")}
              </Button>
            </div>
          )}
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.developer.s60")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("page.developer.s11")}</TableHead>
                  <TableHead>{t("page.developer.s56")}</TableHead>
                  <TableHead>{t("page.developer.s47")}</TableHead>
                  <TableHead className="text-right">{t("page.developer.s21")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((bot) => (
                  <TableRow key={bot.id}>
                    <TableCell>
                      <div className="font-medium">{bot.name}</div>
                      <div className="text-xs text-muted-foreground">{bot.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{bot.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{bot.kbName ?? bot.kbId}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Switch checked={bot.active} onCheckedChange={() => toggleBot(bot)} />
                        <Button variant="ghost" size="sm" onClick={() => deleteBot(bot.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Chrome 扩展 ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-primary" />
            {t("page.developer.s61")}
          </CardTitle>
          <CardDescription>{t("page.developer.s62")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("page.developer.s63")}</p>
        </CardContent>
      </Card>

      {/* ── n8n / Zapier ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            {t("page.developer.s64")}
          </CardTitle>
          <CardDescription>{t("page.developer.s65")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("page.developer.s69")}</p>
            <pre className="overflow-x-auto text-xs leading-relaxed">
              {t("page.developer.s70")}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">{t("page.developer.s66")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
