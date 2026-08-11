"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { Share2, Copy, Check, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KbDocument } from "@/lib/kb/types";

interface ShareState {
  token: string;
  expiresAt: number | null;
  maxViews: number | null;
  views: number;
}

/** P4-2: create / manage a time-limited public share link for a document. */
export function DocShareDialog({
  doc,
  open,
  onOpenChange,
  onChanged,
}: {
  doc: KbDocument;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [share, setShare] = React.useState<ShareState | null>(null);
  const [days, setDays] = React.useState(7);
  const [password, setPassword] = React.useState("");
  const [maxViews, setMaxViews] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const link = share ? `${window.location.origin}/share-doc/${share.token}` : "";

  const load = React.useCallback(() => {
    fetch(`/api/knowledge-base/${doc.kbId}/documents/${doc.id}/share`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.share) setShare({ token: d.share.token, expiresAt: d.share.expiresAt ?? null, maxViews: d.share.maxViews ?? null, views: d.share.views });
        else setShare(null);
      })
      .catch(() => setShare(null));
  }, [doc.kbId, doc.id]);

  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-base/${doc.kbId}/documents/${doc.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresAt: days > 0 ? Date.now() + days * 86_400_000 : null,
          password: password.trim() || null,
          maxViews: maxViews ? Number(maxViews) : null,
        }),
      });
      if (res.ok) {
        load();
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!share) return;
    await fetch(`/api/knowledge-base/${doc.kbId}/documents/${doc.id}/share`, { method: "DELETE" });
    setShare(null);
    onChanged();
  }

  function copy() {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" /> 分享文档
          </DialogTitle>
          <DialogDescription className="truncate">{doc.name}</DialogDescription>
        </DialogHeader>

        {share ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{t("page.doc-share-dialog.s0")}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1 text-xs">{link}</code>
                <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("page.doc-share-dialog.s6") : t("page.doc-share-dialog.s7")}
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>{share.expiresAt ? `${t("page.doc-share-dialog.s16", { date: new Date(share.expiresAt).toLocaleDateString() })}` : t("page.doc-share-dialog.s17")}</span>
                {share.maxViews !== null && <span>已访问 {share.views} / {share.maxViews} 次</span>}
              </div>
            </div>
            <Button variant="destructive" size="sm" className="w-full" onClick={revoke}>
              <Trash2 className="h-3.5 w-3.5" /> 撤销分享
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">{t("page.doc-share-dialog.s1")}</Label>
                <Input type="number" min={0} value={days} onChange={(e) => setDays(+e.target.value || 0)} className="h-8 text-sm" />
                <p className="text-[11px] text-muted-foreground">{t("page.doc-share-dialog.s2")}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">{t("page.doc-share-dialog.s3")}</Label>
                <Input type="number" min={1} value={maxViews} onChange={(e) => setMaxViews(e.target.value)} placeholder={t("page.doc-share-dialog.s8")} className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t("page.doc-share-dialog.s4")}</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("page.doc-share-dialog.s9")} className="h-8 text-sm" />
            </div>
          </div>
        )}

        <DialogFooter>
          {!share && (
            <Button variant="gradient" onClick={create} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              生成分享链接
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("page.doc-share-dialog.s5")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
