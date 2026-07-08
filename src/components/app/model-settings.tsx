"use client";
import * as React from "react";
import {
  Bot, Plus, Trash2, Zap, Star, StarOff, Loader2, CheckCircle2,
  XCircle, KeyRound, Server, Cpu, ExternalLink, Sparkles,
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
            <Bot className="h-4 w-4 text-primary" /> 外部 AI 模型
          </CardTitle>
          <Button size="sm" variant="gradient" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> 添加模型
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            导入 OpenAI / DeepSeek / Moonshot / 硅基流动 / Ollama 等 OpenAI 兼容模型，启用后驱动智能问答与 Agent 调研。未配置时使用本地演示模式。
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
                <p className="text-sm font-medium">尚未配置外部模型</p>
                <p className="mt-1 text-xs text-muted-foreground">添加你的第一个 AI 模型以解锁完整的 RAG 与 Agent 能力</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" /> 添加模型
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
                                <Star className="h-2.5 w-2.5" /> 默认
                              </Badge>
                            )}
                            {m.enabled ? (
                              <Badge variant="success" className="text-[10px]">已启用</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">已停用</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.providerName} · {m.chatModel}
                          </p>
                          {m.embeddingModel && (
                            <p className="text-xs text-muted-foreground">
                              嵌入: {m.embeddingModel}
                            </p>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <KeyRound className="h-3 w-3" />
                            {m.hasKey ? m.apiKeyMasked : "无 Key"}
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
                              {m.lastTestOk ? "连接正常" : "连接失败"} · {formatRelative(m.lastTestedAt)}
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
                        测试连接
                      </Button>
                      {!m.isDefault && (
                        <Button size="sm" variant="outline" onClick={() => patch(m.id, { isDefault: true })}>
                          <Star className="h-3.5 w-3.5" /> 设为默认
                        </Button>
                      )}
                      {m.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => patch(m.id, { isDefault: false })}>
                          <StarOff className="h-3.5 w-3.5" /> 取消默认
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => remove(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> 删除
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

  const preset = providers.find((p) => p.id === providerId);

  function onProviderChange(id: string) {
    const p = providers.find((x) => x.id === id);
    setProviderId(id);
    if (p) {
      setBaseUrl(p.baseUrl);
      setChatModel(p.chatModels[0] ?? "");
      setEmbeddingModel(p.embeddingModels[0] ?? "");
    }
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
        setTestResult({ ok: true, msg: `连接成功${d.reply ? `：${d.reply}` : ""}（${d.latency}ms）` });
      } else {
        setTestResult({ ok: false, msg: d.error || "连接失败" });
      }
    } catch {
      setTestResult({ ok: false, msg: "网络错误" });
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
        setError(d.error || "保存失败");
      } else {
        onSaved();
      }
    } catch {
      setError("网络错误");
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" /> 添加外部模型
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-2">
            <Label>提供商</Label>
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
                <ExternalLink className="h-3 w-3" /> 获取 API Key
              </a>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>显示名称（可选）</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder={`如：${preset?.name} · ${chatModel || "模型"}`} />
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

          {/* Chat Model */}
          <div className="space-y-2">
            <Label>对话模型 <span className="text-destructive">*</span></Label>
            <Input value={chatModel} onChange={(e) => setChatModel(e.target.value)}
                   placeholder="如 gpt-4o-mini" list="chat-models" />
            {preset && preset.chatModels.length > 0 && (
              <datalist id="chat-models">
                {preset.chatModels.map((m) => <option key={m} value={m} />)}
              </datalist>
            )}
          </div>

          {/* Embedding Model */}
          <div className="space-y-2">
            <Label>嵌入模型（可选）</Label>
            <Input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)}
                   placeholder="留空则使用本地嵌入" list="emb-models" />
            {preset && preset.embeddingModels.length > 0 && (
              <datalist id="emb-models">
                {preset.embeddingModels.map((m) => <option key={m} value={m} />)}
              </datalist>
            )}
            <p className="text-xs text-muted-foreground">用于文档向量化；留空时回退本地哈希嵌入</p>
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
            测试连接
          </Button>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="gradient" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
