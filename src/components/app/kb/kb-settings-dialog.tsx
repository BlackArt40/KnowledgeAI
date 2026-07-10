"use client";

import * as React from "react";
import { Settings2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type KnowledgeBase, type KbSettings } from "@/lib/kb/types";

// Built-in preset embedding models (always available, no config needed).
const PRESET_MODELS = [
  { value: "text-embedding-3-small", label: "OpenAI · text-embedding-3-small" },
  { value: "text-embedding-3-large", label: "OpenAI · text-embedding-3-large" },
  { value: "bge-large-zh", label: "BAAI · bge-large-zh (中文)" },
  { value: "m3e-base", label: "Moka · m3e-base" },
];

export function KbSettingsDialog({
  kb,
  onSaved,
  open: openProp,
  onOpenChange,
}: {
  kb: KnowledgeBase;
  onSaved: (kb: KnowledgeBase) => void;
  /** Controlled open state (e.g. opened from a parent menu). When omitted the
   *  dialog manages its own state and renders its built-in trigger button. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? (openProp as boolean) : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<KbSettings>(kb.settings);
  // Embedding models imported by the user in Settings -> AI models.
  const [userEmbModels, setUserEmbModels] = React.useState<{ value: string; label: string }[]>([]);

  // Fetch the user's configured external models and surface their embedding
  // models as a separate "user-configured" group (excluding built-in presets).
  React.useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const presetValues = new Set(PRESET_MODELS.map((m) => m.value));
        const seen = new Set<string>();
        const userModels: { value: string; label: string }[] = [];
        for (const m of d.models ?? []) {
          if (!m.embeddingModel) continue;
          // Skip duplicates of built-in presets (they already appear above).
          if (presetValues.has(m.embeddingModel) || seen.has(m.embeddingModel)) continue;
          seen.add(m.embeddingModel);
          userModels.push({
            value: m.embeddingModel,
            label: `${m.providerName} · ${m.embeddingModel}${m.enabled ? "" : "（未启用）"}`,
          });
        }
        setUserEmbModels(userModels);
      })
      .catch(() => setUserEmbModels([]));
  }, []);

  React.useEffect(() => {
    if (open) setForm(kb.settings);
  }, [open, kb.settings]);

  function set<K extends keyof KbSettings>(key: K, value: KbSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-base/${kb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("保存失败");
      const { kb: updated } = await res.json();
      onSaved(updated);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  // Whether the currently selected embedding model is a user-configured one.
  const selectedIsUser = userEmbModels.some((m) => m.value === form.embeddingModel);
  // Fallback: keep the current value selectable if it's missing from both groups.
  const selectedMissing =
    !!form.embeddingModel &&
    !PRESET_MODELS.some((m) => m.value === form.embeddingModel) &&
    !userEmbModels.some((m) => m.value === form.embeddingModel);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings2 className="h-4 w-4" /> 设置
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>知识库设置</DialogTitle>
          <DialogDescription>
            调整切片与检索参数。修改后新文档将按新参数处理。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>切片大小</Label>
              <span className="text-sm font-medium tabular-nums text-primary">
                {form.chunkSize} tokens
              </span>
            </div>
            <Slider
              value={[form.chunkSize]}
              onValueChange={(v) => set("chunkSize", v[0])}
              min={100}
              max={2000}
              step={50}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>切片重叠</Label>
              <span className="text-sm font-medium tabular-nums text-primary">
                {form.chunkOverlap} tokens
              </span>
            </div>
            <Slider
              value={[form.chunkOverlap]}
              onValueChange={(v) => set("chunkOverlap", v[0])}
              min={0}
              max={300}
              step={10}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Embedding 模型</Label>
              <span className="text-xs text-muted-foreground">
                {selectedIsUser ? "用户配置" : selectedMissing ? "其他" : "自带预设"}
              </span>
            </div>
            <Select
              value={form.embeddingModel}
              onValueChange={(v) => set("embeddingModel", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>自带预设</SelectLabel>
                  {PRESET_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {userEmbModels.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>用户配置（设置 → AI 模型）</SelectLabel>
                    {userEmbModels.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {selectedMissing && (
                  <SelectItem value={form.embeddingModel}>
                    {form.embeddingModel}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              自带预设 {PRESET_MODELS.length} 个 · 用户配置 {userEmbModels.length} 个（来自 设置 → AI 模型）
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>检索数量 Top-K</Label>
              <span className="text-sm font-medium tabular-nums text-primary">
                {form.topK}
              </span>
            </div>
            <Slider
              value={[form.topK]}
              onValueChange={(v) => set("topK", v[0])}
              min={1}
              max={20}
              step={1}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="gradient" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
