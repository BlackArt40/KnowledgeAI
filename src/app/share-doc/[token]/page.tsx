"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, Lock, Clock, EyeOff, Link2Off, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatSize, formatRelative } from "@/lib/format";

interface SharedDoc {
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  content: string;
  expiresAt: number | null;
  views: number;
  maxViews: number | null;
}

type ErrorCode = "needPassword" | "expired" | "exhausted" | "notFound";

function errorUi(t: (k: string) => string): Record<ErrorCode, { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }> {
  return {
    needPassword: { icon: Lock, title: t("page.share-doc.s1"), desc: t("page.share-doc.s6") },
    expired: { icon: Clock, title: t("page.share-doc.s7"), desc: t("page.share-doc.s8") },
    exhausted: { icon: EyeOff, title: t("page.share-doc.s9"), desc: t("page.share-doc.s10") },
    notFound: { icon: Link2Off, title: t("page.share-doc.s11"), desc: t("page.share-doc.s12") },
  };
}

// P4-2: public page for a shared document (no login required).
export default function ShareDocPage() {
  const t = useT();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = React.useState<SharedDoc | null>(null);
  const [errorCode, setErrorCode] = React.useState<ErrorCode | null>(null);
  const [pwd, setPwd] = React.useState("");
  const [pwdError, setPwdError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const fetchPublic = React.useCallback(async (password?: string) => {
    setLoading(true);
    setErrorCode(null);
    try {
      const qs = password ? `?password=${encodeURIComponent(password)}` : "";
      const res = await fetch(`/api/share/doc/${token}${qs}`, { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorCode((body.code as ErrorCode) ?? "notFound");
      }
    } catch {
      setErrorCode("notFound");
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPublic();
  }, [fetchPublic]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError(false);
    const res = await fetch(`/api/share/doc/${token}?password=${encodeURIComponent(pwd)}`, { cache: "no-store" });
    if (res.status === 401) setPwdError(true);
    else if (res.ok) {
      setData(await res.json());
      setErrorCode(null);
    } else {
      const body = await res.json().catch(() => ({}));
      setErrorCode((body.code as ErrorCode) ?? "notFound");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (errorCode && errorCode !== "needPassword") {
    const E = errorUi(t)[errorCode];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <E.icon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{E.title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{E.desc}</p>
        <Button variant="outline" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4" />{t("page.share-doc.s0")}</Link>
        </Button>
      </div>
    );
  }

  if (errorCode === "needPassword" || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t("page.share-doc.s1")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          该文档分享链接受密码保护，请输入密码查看内容
        </p>
        <form onSubmit={submitPassword} className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder={t("page.share-doc.s13")}
            className="text-center"
            autoFocus
          />
          {pwdError && <p className="text-xs text-destructive">{t("page.share-doc.s2")}</p>}
          <Button type="submit">{t("page.share-doc.s3")}</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>{t("page.share-doc.s4")}</span>
          <Badge variant="secondary" className="ml-auto font-normal">
            {data.views} 次访问{data.maxViews ? ` / ${data.maxViews}` : ""}
          </Badge>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-6">
          <h1 className="break-all text-2xl font-bold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.type === "web" ? t("page.share-doc.s14") : formatSize(data.size)} · 上传于 {formatRelative(data.uploadedAt)}
            {data.expiresAt && ` · ${t("page.share-doc.s16", { date: new Date(data.expiresAt).toLocaleDateString() })}`}
          </p>
          <pre className="mt-5 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-4 font-mono text-sm leading-relaxed">
            {data.content || t("page.share-doc.s15")}
          </pre>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          由 KnowledgeAI 团队共享 · <Link href="/" className="underline">{t("page.share-doc.s5")}</Link>
        </p>
      </div>
    </div>
  );
}
