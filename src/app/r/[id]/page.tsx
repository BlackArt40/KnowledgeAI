"use client";
import * as React from "react";
import { use } from "react";
import { FileText, Clock, Sparkles, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/app/agent/markdown";
import { formatRelative } from "@/lib/format";
import Link from "next/link";

interface SharedReport {
  topic: string;
  report: string;
  citations: { n: number; title: string; snippet: string; source: string; score: number }[];
  outputFormat: string;
  durationMs?: number;
  createdAt: number;
}

export default function SharedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = React.useState<SharedReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/agent/public/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  function copyReport() {
    if (!data?.report) return;
    navigator.clipboard?.writeText(data.report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl">📭</span>
        <h1 className="text-xl font-bold">{error}</h1>
        <p className="text-sm text-muted-foreground">该报告可能已被删除或链接无效</p>
        <Link href="/"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> 返回首页</Button></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /> 返回</Button></Link>
        <Badge variant="secondary"><Sparkles className="h-3 w-3" /> KnowledgeAI 共享报告</Badge>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{data!.topic}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatRelative(data!.createdAt)}</span>
          {data!.durationMs && <span>耗时 {(data!.durationMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> 调研报告</h2>
          <Button variant="outline" size="sm" onClick={copyReport}>
            {copied ? <Check className="h-3.5 w-3.5" /> : null} 复制
          </Button>
        </div>
        <Markdown text={data!.report} />
      </div>

      {data!.citations.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">引用来源 ({data!.citations.length})</h3>
          <div className="space-y-2">
            {data!.citations.map((c) => (
              <div key={c.n} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">{c.n}</span>
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="line-clamp-1 text-xs font-medium">{c.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
