"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const COLORS = [
  { value: "from-indigo-500/15", cls: "bg-indigo-500" },
  { value: "from-emerald-500/15", cls: "bg-emerald-500" },
  { value: "from-amber-500/15", cls: "bg-amber-500" },
  { value: "from-sky-500/15", cls: "bg-sky-500" },
  { value: "from-fuchsia-500/15", cls: "bg-fuchsia-500" },
  { value: "from-rose-500/15", cls: "bg-rose-500" },
];

export function NewKbDialog({
  trigger,
  open,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  /** P5-2: controlled mode (global search ?new=1 deep-link). When omitted the
   *  dialog manages its own open state. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [internal, setInternal] = React.useState(false);
  const isOpen = open ?? internal;
  const setOpen = onOpenChange ?? setInternal;
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0].value);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, desc, color }),
      });
      if (!res.ok) throw new Error(t("page.new-kb-dialog.s4"));
      const { kb } = await res.json();
      setOpen(false);
      setName("");
      setDesc("");
      router.push(`/knowledge-base/${kb.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="gradient">
            <Plus className="h-4 w-4" /> {t("page.new-kb-dialog.s0")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("page.new-kb-dialog.s0")}</DialogTitle>
          <DialogDescription>
            创建一个知识库，随后上传文档即可开始向量化。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="kb-name">{t("page.new-kb-dialog.s1")}</Label>
            <Input
              id="kb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("page.new-kb-dialog.s5")}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-desc">{t("page.new-kb-dialog.s2")}</Label>
            <Input
              id="kb-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("page.new-kb-dialog.s6")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("page.new-kb-dialog.s3")}</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className={cn(
                    "h-8 w-8 rounded-lg transition-transform hover:scale-110",
                    c.cls,
                    color === c.value &&
                      "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                  )}
                  aria-label={t("page.new-kb-dialog.s7")}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="gradient" onClick={create} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
