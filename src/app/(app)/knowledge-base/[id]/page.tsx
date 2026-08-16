"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  Layers,
  HardDrive,
  Loader2,
  MessagesSquare,
  Network,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadZone } from "@/components/app/kb/upload-zone";
import { DocumentList } from "@/components/app/kb/document-list";
import { KbSettingsDialog } from "@/components/app/kb/kb-settings-dialog";
import { DocShareDialog } from "@/components/app/kb/doc-share-dialog";
import { useSse } from "@/lib/use-sse";
import { formatSize } from "@/lib/format";
import type { KnowledgeBase, KbDocument } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

type Detail = {
  kb: KnowledgeBase;
  docs: KbDocument[];
  stats: { total: number; ready: number; processing: number; chunks: number; size: number };
};

export default function KbDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = React.useState<Detail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // P4-2: share-link dialog target document.
  const [shareDoc, setShareDoc] = React.useState<KbDocument | null>(null);

  const fetchDetail = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge-base/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setError(t("page.knowledge-base-[id].s1"));
        return;
      }
      if (!res.ok) throw new Error();
      const json = await res.json();
      setData(json);
    } catch {
      setError(t("page.knowledge-base-[id].s2"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

  // P4-1: realtime collaboration - live KB changes (settings/docs/progress)
  // made by other members refresh this view instantly.
  useSse(`/api/kb/${id}/events`, (event) => {
    if (!event?.type) return;
    if (event.type === "doc_status") {
      // Cheap local progress update; no full refetch per tick.
      setData((d) =>
        d
          ? {
              ...d,
              docs: d.docs.map((x) =>
                x.id === event.docId
                  ? { ...x, status: event.status, progress: event.progress }
                  : x
              ),
            }
          : d
      );
    } else if (event.type === "deleted") {
      setError(t("page.knowledge-base-[id].s3"));
    } else {
      // settings / docs / doc_deleted -> full refresh
      fetchDetail();
    }
  });

  async function deleteDoc(docId: string) {
    // optimistic remove
    setData((d) =>
      d ? { ...d, docs: d.docs.filter((x) => x.id !== docId) } : d
    );
    await fetch(`/api/knowledge-base/${id}/documents/${docId}`, {
      method: "DELETE",
    });
    fetchDetail();
  }

  if (loading) return <DetailSkeleton />;
  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <p className="text-lg font-semibold">{error}</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/knowledge-base">
            <ArrowLeft className="h-4 w-4" /> {t("page.knowledge-base-[id].s31")}
          </Link>
        </Button>
      </div>
    );
  }

  const { kb, docs, stats } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* breadcrumb / back */}
      <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link href="/knowledge-base" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("page.knowledge-base-[id].s32")}
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{kb.name}</span>
      </div>

      {/* header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar
            fallback={kb.initial}
            className={cn("h-12 w-12 bg-gradient-to-b to-transparent text-base shadow-sm ring-1 ring-border", kb.color)}
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{kb.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{kb.desc || t("page.knowledge-base-[id].s4")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="font-normal">
                {t("page.knowledge-base-[id].s33", { n: kb.settings.chunkSize })}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {t("page.knowledge-base-[id].s34", { n: kb.settings.chunkOverlap })}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                Top-K {kb.settings.topK}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {kb.settings.embeddingModel}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/chat">
              <MessagesSquare className="h-4 w-4" /> {t("page.knowledge-base-[id].s35")}
            </Link>
          </Button>
          {/* P7-3: knowledge-graph visualization entry */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/knowledge-base/${kb.id}/graph`}>
              <Network className="h-4 w-4" /> {t("page.knowledge-base-[id].s30")}
            </Link>
          </Button>
          <KbSettingsDialog kb={kb} onSaved={(updated) => setData((d) => (d ? { ...d, kb: updated } : d))} />
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={FileText} label={t("page.knowledge-base-[id].s5")} value={stats.total} />
        <StatTile icon={CheckCircle2} label={t("page.knowledge-base-[id].s6")} value={stats.ready} accent="text-success" />
        <StatTile icon={Layers} label={t("page.knowledge-base-[id].s7")} value={stats.chunks} />
        <StatTile icon={HardDrive} label={t("page.knowledge-base-[id].s8")} value={formatSize(stats.size)} />
      </div>

      {/* upload */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("page.knowledge-base-[id].s0")}</h2>
        <UploadZone kbId={kb.id} onUploaded={fetchDetail} />
      </section>

      {/* documents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {t("page.knowledge-base-[id].s36")}
            <span className="ml-1.5 text-muted-foreground">({docs.length})</span>
          </h2>
          {stats.processing > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("page.knowledge-base-[id].s37", { count: stats.processing })}
            </span>
          )}
        </div>
        <DocumentList docs={docs} onRefresh={fetchDetail} onDelete={deleteDoc} onShare={setShareDoc} />
      </section>

      {shareDoc && (
        <DocShareDialog
          doc={shareDoc}
          open={!!shareDoc}
          onOpenChange={(v) => { if (!v) setShareDoc(null); }}
          onChanged={fetchDetail}
        />
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Icon className={cn("h-4 w-4 text-muted-foreground", accent)} />
      <p className="mt-2 text-xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
