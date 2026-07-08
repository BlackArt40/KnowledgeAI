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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMBEDDING_MODELS, type KnowledgeBase, type KbSettings } from "@/lib/kb/types";

export function KbSettingsDialog({
  kb,
  onSaved,
}: {
  kb: KnowledgeBase;
  onSaved: (kb: KnowledgeBase) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<KbSettings>(kb.settings);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4" /> 设置
        </Button>
      </DialogTrigger>
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
            <Label>Embedding 模型</Label>
            <Select
              value={form.embeddingModel}
              onValueChange={(v) => set("embeddingModel", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
