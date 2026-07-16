"use client";

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
  const [kbs, setKbs] = React.useState<KbWithStats[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [settingsKb, setSettingsKb] = React.useState<KnowledgeBase | null>(null);
  const [deleteKb, setDeleteKb] = React.useState<KbWithStats | null>(null);
  const [deleting, setDeleting] = React.useState(false);

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
          <h2 className="text-xl font-semibold tracking-tight">知识库</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理你的知识库与文档，共 {kbs.length} 个知识库。
          </p>
        </div>
        <NewKbDialog />
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
                <span className="text-sm font-medium">新建知识库</span>
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

                    <h3 className="mt-3 flex items-center gap-2 text-base font-semibold">
                      {kb.name}
                      {kb.shared && (
                        <Badge variant="secondary" className="text-[10px]">{kb.ownerName} 共享</Badge>
                      )}
                    </h3>
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {kb.desc || "暂无描述"}
                    </p>

                    <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        {kb.stats.total} 篇
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />
                        {kb.stats.chunks} 切片
                      </span>
                      <span>·</span>
                      <span>{formatRelative(kb.updatedAt)}</span>
                      {kb.stats.processing > 0 ? (
                        <Badge variant="warning" className="ml-auto">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                          处理中
                        </Badge>
                      ) : (
                        <Badge variant="success" className="ml-auto">
                          就绪
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
                      aria-label="更多操作"
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                >
                  <DropdownMenuItem onClick={() => setSettingsKb(kb)}>
                    <Settings className="h-4 w-4" /> 知识库设置
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteKb(kb)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" /> 删除知识库
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
            <DialogTitle>删除知识库</DialogTitle>
            <DialogDescription>
              确定删除「{deleteKb?.name}」？该知识库的所有文档与向量索引将被永久删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteKb(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}{" "}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
