"use client";

import { useT } from "@/lib/i18n/provider";
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
  const t = useT();
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
      setError(t("page.report-share.s9"));
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
        if (!cancelled) setError(t("page.report-share.s9"));
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
        <h1 className="text-xl font-bold">{t("page.report-share.s0")}</h1>
        <p className="text-sm text-muted-foreground">{t("page.report-share.s1")}</p>
        {pwdError && <p className="text-xs text-red-500">{t("page.report-share.s2")}</p>}
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
            placeholder={t("page.report-share.s10")}
            autoFocus
          />
          <Button type="submit" variant="gradient">{t("page.report-share.s3")}</Button>
        </form>
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" />{t("page.report-share.s4")}</Button></Link>
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
          {errorCode === "expired" ? t("page.report-share.s11") :
            errorCode === "exhausted" ? t("page.report-share.s12") :
            errorCode === "disabled" ? t("page.report-share.s13") : t("page.report-share.s14")}
        </p>
        <Link href="/"><Button variant="outline"><ArrowLeft className="h-4 w-4" />{t("page.report-share.s4")}</Button></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" />{t("page.report-share.s5")}</Button></Link>
        <div className="flex items-center gap-2">
          {data!.protected && (
            <Badge variant="secondary"><Lock className="h-3 w-3" />{t("page.report-share.s6")}</Badge>
          )}
          <Badge variant="secondary"><Sparkles className="h-3 w-3" />{t("page.report-share.s7")}</Badge>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{data!.topic}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatRelative(data!.createdAt)}</span>
          {data!.durationMs && <span>{t("page.report-share.s15", { sec: (data!.durationMs / 1000).toFixed(1) })}</span>}
          {data!.views !== undefined && data!.views > 0 && <span>{t("page.report-share.s16", { count: data!.views })}</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" />{t("page.report-share.s8")}</h2>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={copyReport}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {t("common.copy")}
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
          <h3 className="mb-3 text-sm font-semibold">{t("page.report-share.s17", { count: data!.citations.length })}</h3>
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
            <MessageSquare className="h-4 w-4 text-muted-foreground" /> {t("page.report-share.s18", { count: data!.comments.length })}
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
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">{t("page.report-share.s19", { n: c.citeN })}</Badge>
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
