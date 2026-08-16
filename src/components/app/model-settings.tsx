"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import {
  Bot, Plus, Trash2, Zap, Star, StarOff, Loader2, CheckCircle2,
  XCircle, KeyRound, Server, Cpu, ExternalLink, Sparkles,
  Download, RefreshCw, Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Types (mirror src/lib/models/types.ts) ───────────────────────────────
interface ProviderPreset {
  id: string; name: string; baseUrl: string; docsUrl: string;
  needsKey: boolean; keyPlaceholder: string; keyHint: string;
  chatModels: string[]; embeddingModels: string[];
}
interface ModelConfigSafe {
  id: string; name: string; provider: string; providerName: string;
  apiKeyMasked: string; hasKey: boolean; baseUrl: string;
  chatModel: string; embeddingModel: string;
  enabled: boolean; isDefault: boolean;
  lastTestedAt: number | null; lastTestOk: boolean | null;
  createdAt: number;
}

const PROVIDER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  openai: Sparkles, deepseek: Bot, moonshot: Bot, siliconflow: Cpu,
  ollama: Server, custom: Server,
};

export function ModelSettings() {
  const t = useT();
  const [models, setModels] = React.useState<ModelConfigSafe[]>([]);
  const [providers, setProviders] = React.useState<ProviderPreset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showAdd, setShowAdd] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const d = await fetch("/api/models", { cache: "no-store" }).then((r) => r.json());
      setModels(d.models ?? []);
      setProviders(d.providers ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refresh(); }, [refresh]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/models/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/models/${id}`, { method: "DELETE" });
    refresh();
  }

  async function test(id: string) {
    setTestingId(id);
    try {
      await fetch("/api/models/test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
    } catch { /* ignore */ }
    refresh();
    setTestingId(null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-primary" /> {t("page.model-settings.s29")}
          </CardTitle>
          <Button size="sm" variant="gradient" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> {t("page.model-settings.s30")}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("page.model-settings.s31")}
          </p>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          ) : models.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("page.model-settings.s0")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("page.model-settings.s1")}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" /> {t("page.model-settings.s30")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {models.map((m) => {
                const Icon = PROVIDER_ICON[m.provider] ?? Server;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-xl border p-4 transition-colors",
                      m.enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          m.enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">{m.name}</p>
                            {m.isDefault && (
                              <Badge variant="default" className="gap-0.5 text-[10px]">
                                <Star className="h-2.5 w-2.5" /> {t("page.model-settings.s32")}
                              </Badge>
                            )}
                            {m.enabled ? (
                              <Badge variant="success" className="text-[10px]">{t("page.model-settings.s2")}</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">{t("page.model-settings.s3")}</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.providerName} · {m.chatModel}
                          </p>
                          {m.embeddingModel && (
                            <p className="text-xs text-muted-foreground">
                              {t("page.model-settings.s33", { model: m.embeddingModel })}
                            </p>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <KeyRound className="h-3 w-3" />
                            {m.hasKey ? m.apiKeyMasked : t("page.model-settings.s14")}
                            {" · "}
                            <Server className="h-3 w-3" />
                            {m.baseUrl}
                          </p>
                          {m.lastTestedAt && (
                            <p className={cn(
                              "mt-1 flex items-center gap-1 text-[11px]",
                              m.lastTestOk ? "text-success" : "text-destructive"
                            )}>
                              {m.lastTestOk ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                              {m.lastTestOk ? t("page.model-settings.s15") : t("page.model-settings.s16")} · {formatRelative(m.lastTestedAt)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={m.enabled}
                          onCheckedChange={(v) => patch(m.id, { enabled: v })}
                        />
                      </div>
                    </div>

                    <Separator className="my-3" />

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => test(m.id)} disabled={testingId === m.id}>
                        {testingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        {t("page.model-settings.s34")}
                      </Button>
                      {!m.isDefault && (
                        <Button size="sm" variant="outline" onClick={() => patch(m.id, { isDefault: true })}>
                          <Star className="h-3.5 w-3.5" /> {t("page.model-settings.s35")}
                        </Button>
                      )}
                      {m.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => patch(m.id, { isDefault: false })}>
                          <StarOff className="h-3.5 w-3.5" /> {t("page.model-settings.s36")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => remove(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showAdd && (
        <AddModelDialog
          providers={providers}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Add Model Dialog ─────────────────────────────────────────────────────

function AddModelDialog({
  providers, onClose, onSaved,
}: {
  providers: ProviderPreset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [providerId, setProviderId] = React.useState("openai");
  const [name, setName] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(providers[0]?.baseUrl ?? "");
  const [chatModel, setChatModel] = React.useState("");
  const [embeddingModel, setEmbeddingModel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // fetched model list from provider
  const [fetched, setFetched] = React.useState<{ chat: string[]; embedding: string[] } | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetchInfo, setFetchInfo] = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [manualChat, setManualChat] = React.useState(false);
  const [manualEmb, setManualEmb] = React.useState(false);

  const preset = providers.find((p) => p.id === providerId);

  function onProviderChange(id: string) {
    const p = providers.find((x) => x.id === id);
    setProviderId(id);
    if (p) {
      setBaseUrl(p.baseUrl);
    }
    // Clear model fields - user should pull list or type manually
    setChatModel("");
    setEmbeddingModel("");
    // reset fetched list when provider changes
    setFetched(null);
    setFetchInfo(null);
    setManualChat(false);
    setManualEmb(false);
  }

  async function fetchModels() {
    setFetching(true);
    setFetchInfo(null);
    setError(null);
    try {
      const res = await fetch("/api/models/fetch-list", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, baseUrl }),
      });
      const d = await res.json();
      if (d.ok) {
        setFetched({ chat: d.chat ?? [], embedding: d.embedding ?? [] });
        setManualChat(false);
        setManualEmb(false);
        // auto-select first chat model if current is empty or not in list
        if (d.chat?.length > 0 && !d.chat.includes(chatModel)) {
          setChatModel(d.chat[0]);
        }
        setFetchInfo({ ok: true, msg: t("page.model-settings.s22", { count: d.count, chat: d.chat.length, emb: d.embedding.length, latency: d.latency }) });
      } else {
        setFetchInfo({ ok: false, msg: d.error || t("page.model-settings.s17") });
      }
    } catch {
      setFetchInfo({ ok: false, msg: t("page.model-settings.s18") });
    }
    setFetching(false);
  }

  async function doTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey, baseUrl, chatModel }),
      });
      const d = await res.json();
      if (d.ok) {
        setTestResult({ ok: true, msg: t("page.model-settings.s23", { reply: d.reply ? `：${d.reply}` : "", latency: d.latency }) });
      } else {
        setTestResult({ ok: false, msg: d.error || t("page.model-settings.s16") });
      }
    } catch {
      setTestResult({ ok: false, msg: t("page.model-settings.s18") });
    }
    setTesting(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider: providerId, apiKey, baseUrl, chatModel, embeddingModel }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || t("page.model-settings.s19"));
      } else {
        onSaved();
      }
    } catch {
      setError(t("page.model-settings.s18"));
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" /> {t("page.model-settings.s37")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-2">
            <Label>{t("page.model-settings.s4")}</Label>
            <Select value={providerId} onValueChange={onProviderChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset?.docsUrl && (
              <a href={preset.docsUrl} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> {t("page.model-settings.s38")}
              </a>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>{t("page.model-settings.s5")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder={t("page.model-settings.s25", { preset: preset?.name ?? "", model: chatModel || t("page.model-settings.s24") })} />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label>API Key {preset?.needsKey && <span className="text-destructive">*</span>}</Label>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   type="password" placeholder={preset?.keyPlaceholder ?? "sk-..."} />
            {preset?.keyHint && <p className="text-xs text-muted-foreground">{preset.keyHint}</p>}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                   placeholder="https://api.openai.com/v1" />
          </div>

          {/* Fetch model list */}
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchModels}
              disabled={fetching || !baseUrl}
              className="w-full"
            >
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {fetching ? t("page.model-settings.s20") : t("page.model-settings.s21")}
            </Button>
            {fetchInfo && (
              <div className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                fetchInfo.ok ? "border-success/30 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"
              )}>
                {fetchInfo.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{fetchInfo.msg}</span>
              </div>
            )}
          </div>

          {/* Chat Model */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("page.model-settings.s0")}<span className="text-destructive">*</span></Label>
              {fetched && (
                <button type="button" onClick={() => setManualChat((v) => !v)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {manualChat ? <><RefreshCw className="h-3 w-3" />{t("page.model-settings.s1")}</> : <><Pencil className="h-3 w-3" />{t("page.model-settings.s2")}</>}
                </button>
              )}
            </div>
            {fetched && !manualChat && fetched.chat.length > 0 ? (
              <Select value={chatModel} onValueChange={setChatModel}>
                <SelectTrigger><SelectValue placeholder={t("page.model-settings.s22")} /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {fetched.chat.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={chatModel} onChange={(e) => setChatModel(e.target.value)}
                     placeholder={preset?.chatModels[0] ? t("page.model-settings.s26", { m: preset.chatModels[0] }) : t("page.model-settings.s27")} />
            )}
            {preset && preset.chatModels.length > 0 && (!fetched || manualChat) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("page.model-settings.s9")}</span>
                {preset.chatModels.map((m) => (
                  <button key={m} type="button" onClick={() => setChatModel(m)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                            chatModel === m
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          )}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Embedding Model */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("page.model-settings.s10")}</Label>
              {fetched && (
                <button type="button" onClick={() => setManualEmb((v) => !v)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {manualEmb ? <><RefreshCw className="h-3 w-3" />{t("page.model-settings.s1")}</> : <><Pencil className="h-3 w-3" />{t("page.model-settings.s2")}</>}
                </button>
              )}
            </div>
            {fetched && !manualEmb && fetched.embedding.length > 0 ? (
              <Select value={embeddingModel || "__none__"} onValueChange={(v) => setEmbeddingModel(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder={t("page.model-settings.s23")} /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__none__">{t("page.model-settings.s11")}</SelectItem>
                  {fetched.embedding.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)}
                     placeholder={preset?.embeddingModels[0] ? t("page.model-settings.s26", { m: preset.embeddingModels[0] }) : t("page.model-settings.s28")} />
            )}
            {preset && preset.embeddingModels.length > 0 && (!fetched || manualEmb) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("page.model-settings.s9")}</span>
                <button type="button" onClick={() => setEmbeddingModel("")}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                          embeddingModel === ""
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        )}>
                  {t("page.model-settings.s39")}
                </button>
                {preset.embeddingModels.map((m) => (
                  <button key={m} type="button" onClick={() => setEmbeddingModel(m)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                            embeddingModel === m
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          )}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("page.model-settings.s12")}</p>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-sm",
              testResult.ok ? "border-success/30 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"
            )}>
              {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{testResult.msg}</span>
            </div>
          )}
          {error && <p className="text-sm text-destructive">✗ {error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={doTest} disabled={testing || !baseUrl || !chatModel}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {t("page.model-settings.s34")}
          </Button>
          <Button variant="ghost" onClick={onClose}>{t("page.model-settings.s13")}</Button>
          <Button variant="gradient" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
