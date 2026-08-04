"use client";
import * as React from "react";
import { use } from "react";
import {
  FileText,
  Clock,
  Sparkles,
  ArrowLeft,
  Check,
  Lock,
  Download,
  FileDown,
  MessageSquare,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/app/agent/markdown";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { Comment } from "@/lib/agent/types";

interface SharedReport {
  topic: string;
  report: string;
  citations: { n: number; title: string; snippet: string; source: string; score: number }[];
  comments?: Comment[];
  outputFormat: string;
  durationMs?: number;
  createdAt: number;
  protected?: boolean;
  views?: number;
}

export default function SharedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = React.useState<SharedReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const [pwdError, setPwdError] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function fetchPublic(pwd?: string) {
    setLoading(true);
    const headers: Record<string, string> = {};
    if (pwd) headers["x-share-password"] = pwd;
    try {
      const res = await fetch(`/api/agent/public/${id}`, { headers, cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setData(null);
        setError(d.error);
        setErrorCode(d.code ?? null);
        if (d.code === "needPassword" && pwd) setPwdError(true);
      } else {
        setData(d);
        setError(null);
        setErrorCode(null);
        setPwdError(false);
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/public/${id}`, { cache: "no-store" });
        const d = await res.json();
        if (cancelled) return;
        if (d.error) {
          setData(null);
          setError(d.error);
          setErrorCode(d.code ?? null);
        } else {
          setData(d);
          setError(null);
          setErrorCode(null);
        }
      } catch {
        if (!cancelled) setError("加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function copyReport() {
    if (!data?.report) return;
    navigator.clipboard?.writeText(data.report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadMd() {
    if (!data?.report) return;
    const blob = new Blob([data.report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.topic}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  // Password gate (criterion #2)
  if (errorCode === "needPassword") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="h-7 w-7" />
        </span>
        <h1 className="text-xl font-bold">该报告已加密</h1>
        <p className="text-sm text-muted-foreground">请输入访问密码以查看报告</p>
        {pwdError && <p className="text-xs text-red-500">密码错误，请重试</p>}
        <form
          className="flex w-full max-w-xs gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            fetchPublic(password);
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            autoFocus
          />
          <Button type="submit" variant="gradient">解锁</Button>
        </form>
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /> 返回首页</Button></Link>
      </div>
    );
  }

  if (error) {
    const icon = errorCode === "expired" ? "⏰" : errorCode === "exhausted" ? "🔒" : errorCode === "disabled" ? "🚫" : "📭";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl">{icon}</span>
        <h1 className="text-xl font-bold">{error}</h1>
        <p className="text-sm text-muted-foreground">
          {errorCode === "expired" ? "分享链接已过期，请联系报告作者" :
            errorCode === "exhausted" ? "访问次数已达上限" :
            errorCode === "disabled" ? "分享链接已被关闭" : "该报告可能已被删除或链接无效"}
        </p>
        <Link href="/"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> 返回首页</Button></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /> 返回</Button></Link>
        <div className="flex items-center gap-2">
          {data!.protected && (
            <Badge variant="secondary"><Lock className="h-3 w-3" /> 受保护</Badge>
          )}
          <Badge variant="secondary"><Sparkles className="h-3 w-3" /> KnowledgeAI 共享报告</Badge>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{data!.topic}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatRelative(data!.createdAt)}</span>
          {data!.durationMs && <span>耗时 {(data!.durationMs / 1000).toFixed(1)}s</span>}
          {data!.views !== undefined && data!.views > 0 && <span>访问 {data!.views} 次</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> 调研报告</h2>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={copyReport}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} 复制
            </Button>
            <Button variant="outline" size="sm" onClick={downloadMd}>
              <Download className="h-3.5 w-3.5" /> MD
            </Button>
            <Button variant="gradient" size="sm" onClick={() => window.print()}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
          </div>
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
                <span className="mt-1 block break-all text-[10px] text-muted-foreground">{c.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data!.comments && data!.comments.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-muted-foreground" /> 协作评论 ({data!.comments.length})
          </h3>
          <div className="space-y-2">
            {data!.comments.map((c) => (
              <div key={c.id} className={cn("rounded-lg border p-2.5", c.parentId && "ml-4 border-l-2 border-l-primary/30")}>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {(c.userName || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="text-xs font-medium">{c.userName}</span>
                  {c.citeN !== undefined && (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">引用 [{c.citeN}]</Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">{formatRelative(c.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
