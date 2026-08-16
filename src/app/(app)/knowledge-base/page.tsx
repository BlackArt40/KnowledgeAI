"use client";

import { useT } from "@/lib/i18n/provider";


import * as React from "react";
import Link from "next/link";
import { Plus, FileText, Layers, MoreHorizontal, Settings, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { NewKbDialog } from "@/components/app/kb/new-kb-dialog";
import { KbSettingsDialog } from "@/components/app/kb/kb-settings-dialog";
import { formatRelative } from "@/lib/format";
import type { KnowledgeBase } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

type KbWithStats = KnowledgeBase & {
  stats: { total: number; ready: number; processing: number; chunks: number };
  shared?: boolean;
  ownerName?: string;
};

export default function KnowledgeBasePage() {
  const t = useT();
  const [kbs, setKbs] = React.useState<KbWithStats[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [settingsKb, setSettingsKb] = React.useState<KnowledgeBase | null>(null);
  const [deleteKb, setDeleteKb] = React.useState<KbWithStats | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // P5-2: ?new=1 opens the create dialog (global search quick action).
  const [newOpen, setNewOpen] = React.useState(false);

  const fetchList = React.useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const { kbs } = (await res.json()) as { kbs: KbWithStats[] };
      setKbs(kbs);
    } catch {
      // ignore transient errors during polling
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
  }, [fetchList]);

  // P5-2: ?new=1 (global search quick action) opens the create dialog once,
  // then cleans the URL so a refresh doesn't re-open it.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL-driven open
      setNewOpen(true);
      window.history.replaceState(null, "", "/knowledge-base");
    }
  }, []);

  const hasProcessing = kbs.some((k) => k.stats.processing > 0);
  React.useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(fetchList, 2000);
    return () => clearInterval(t);
  }, [hasProcessing, fetchList]);

  async function confirmDelete() {
    if (!deleteKb) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/knowledge-base/${deleteKb.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteKb(null);
        fetchList();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("page.kb.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("page.kb.subtitle", { count: kbs.length })}
          </p>
        </div>
        <NewKbDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NewKbDialog
            trigger={
              <button className="group flex min-h-[176px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card/50 p-6 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Plus className="h-6 w-6" />
                </span>
                <span className="text-sm font-medium">{t("page.kb.newKb")}</span>
              </button>
            }
          />

          {kbs.map((kb) => (
            <div key={kb.id} className="group relative">
              <Link href={`/knowledge-base/${kb.id}`} className="block h-full">
                <Card className="relative h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <div className={cn("absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", kb.color)} />
                  <CardContent className="relative p-5">
                    <Avatar
                      fallback={kb.initial}
                      className={cn("h-11 w-11 bg-card text-base shadow-sm ring-1 ring-border", kb.color)}
                    />

                    <h3 className="mt-3 flex min-w-0 items-center gap-2 text-base font-semibold">
                      <span className="truncate">{kb.name}</span>
                      {kb.shared && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">{t("page.kb.s1", { owner: kb.ownerName ?? "" })}</Badge>
                      )}
                    </h3>
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {kb.desc || t("page.kb.noDesc")}
                    </p>

                    {/* P5-1: wrap on narrow viewports so the badge never squeezes the meta */}
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        {t("page.kb.s2", { count: kb.stats.total })}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />
                        {t("page.kb.s3", { count: kb.stats.chunks })}
                      </span>
                      <span>·</span>
                      <span>{formatRelative(kb.updatedAt)}</span>
                      {kb.stats.processing > 0 ? (
                        <Badge variant="warning" className="ml-auto">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                          {t("page.kb.s4")}
                        </Badge>
                      ) : (
                        <Badge variant="success" className="ml-auto">
                          {t("page.kb.s5")}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>

              {/* more-actions menu (kept outside the Link so it never navigates) */}
              <div className="absolute right-3 top-3 z-10">
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      aria-label={t("page.kb.moreActions")}
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                >
                  <DropdownMenuItem onClick={() => setSettingsKb(kb)}>
                    <Settings className="h-4 w-4" /> {t("page.kb.s6")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteKb(kb)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" /> {t("page.kb.s7")}
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* settings dialog (controlled, opened from the card menu) */}
      {settingsKb && (
        <KbSettingsDialog
          key={settingsKb.id}
          kb={settingsKb}
          open={settingsKb !== null}
          onOpenChange={(v) => !v && setSettingsKb(null)}
          onSaved={(updated) => {
            setSettingsKb(null);
            setKbs((prev) => prev.map((k) => (k.id === updated.id ? { ...k, ...updated } : k)));
          }}
        />
      )}

      {/* delete confirmation */}
      <Dialog open={deleteKb !== null} onOpenChange={(v) => !v && setDeleteKb(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("page.kb.deleteKb")}</DialogTitle>
            <DialogDescription>
              {t("page.kb.s8", { name: deleteKb?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteKb(null)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}{" "}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
