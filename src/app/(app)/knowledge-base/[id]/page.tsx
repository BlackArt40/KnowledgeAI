"use client";

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
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadZone } from "@/components/app/kb/upload-zone";
import { DocumentList } from "@/components/app/kb/document-list";
import { KbSettingsDialog } from "@/components/app/kb/kb-settings-dialog";
import { formatSize } from "@/lib/format";
import type { KnowledgeBase, KbDocument } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

type Detail = {
  kb: KnowledgeBase;
  docs: KbDocument[];
  stats: { total: number; ready: number; processing: number; chunks: number; size: number };
};

export default function KbDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = React.useState<Detail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchDetail = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge-base/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setError("知识库不存在");
        return;
      }
      if (!res.ok) throw new Error();
      const json = await res.json();
      setData(json);
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

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
            <ArrowLeft className="h-4 w-4" /> 返回知识库列表
          </Link>
        </Button>
      </div>
    );
  }

  const { kb, docs, stats } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* breadcrumb / back */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/knowledge-base" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> 知识库
        </Link>
        <span>/</span>
        <span className="text-foreground">{kb.name}</span>
      </div>

      {/* header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar
            fallback={kb.initial}
            className={cn("h-12 w-12 bg-gradient-to-b to-transparent text-base shadow-sm ring-1 ring-border", kb.color)}
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{kb.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{kb.desc || "暂无描述"}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="font-normal">
                切片 {kb.settings.chunkSize}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                重叠 {kb.settings.chunkOverlap}
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
              <MessagesSquare className="h-4 w-4" /> 去问答
            </Link>
          </Button>
          <KbSettingsDialog kb={kb} onSaved={(updated) => setData((d) => (d ? { ...d, kb: updated } : d))} />
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={FileText} label="文档总数" value={stats.total} />
        <StatTile icon={CheckCircle2} label="已就绪" value={stats.ready} accent="text-success" />
        <StatTile icon={Layers} label="切片数量" value={stats.chunks} />
        <StatTile icon={HardDrive} label="占用空间" value={formatSize(stats.size)} />
      </div>

      {/* upload */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">添加文档</h2>
        <UploadZone kbId={kb.id} onUploaded={fetchDetail} />
      </section>

      {/* documents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            文档列表
            <span className="ml-1.5 text-muted-foreground">({docs.length})</span>
          </h2>
          {stats.processing > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {stats.processing} 个文档处理中
            </span>
          )}
        </div>
        <DocumentList docs={docs} onRefresh={fetchDetail} onDelete={deleteDoc} />
      </section>
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
