"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, FileText, Layers, MoreHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { NewKbDialog } from "@/components/app/kb/new-kb-dialog";
import { formatRelative } from "@/lib/format";
import type { KnowledgeBase } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

type KbWithStats = KnowledgeBase & {
  stats: { total: number; ready: number; processing: number; chunks: number };
};

export default function KnowledgeBasePage() {
  const [kbs, setKbs] = React.useState<KbWithStats[]>([]);
  const [loading, setLoading] = React.useState(true);

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
    fetchList();
  }, [fetchList]);

  const hasProcessing = kbs.some((k) => k.stats.processing > 0);
  React.useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(fetchList, 2000);
    return () => clearInterval(t);
  }, [hasProcessing, fetchList]);

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
            <Link key={kb.id} href={`/knowledge-base/${kb.id}`} className="block">
              <Card className="group relative h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                <div className={cn("absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", kb.color)} />
                <CardContent className="relative p-5">
                  <div className="flex items-start justify-between">
                    <Avatar
                      fallback={kb.initial}
                      className={cn("h-11 w-11 bg-card text-base shadow-sm ring-1 ring-border", kb.color)}
                    />
                    <span
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </span>
                  </div>

                  <h3 className="mt-3 text-base font-semibold">{kb.name}</h3>
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
          ))}
        </div>
      )}
    </div>
  );
}
