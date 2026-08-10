"use client";

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

const ERROR_UI: Record<ErrorCode, { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }> = {
  needPassword: { icon: Lock, title: "需要访问密码", desc: "该文档分享链接受密码保护" },
  expired: { icon: Clock, title: "链接已过期", desc: "分享链接已超过有效期，请联系文档所有者重新分享" },
  exhausted: { icon: EyeOff, title: "访问次数已用尽", desc: "该分享链接已达到访问次数上限" },
  notFound: { icon: Link2Off, title: "链接无效", desc: "分享链接不存在或已被撤销" },
};

// P4-2: public page for a shared document (no login required).
export default function ShareDocPage() {
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
    const E = ERROR_UI[errorCode];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <E.icon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{E.title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{E.desc}</p>
        <Button variant="outline" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4" /> 返回首页</Link>
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
        <h1 className="text-2xl font-bold tracking-tight">需要访问密码</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          该文档分享链接受密码保护，请输入密码查看内容
        </p>
        <form onSubmit={submitPassword} className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="访问密码"
            className="text-center"
            autoFocus
          />
          {pwdError && <p className="text-xs text-destructive">密码不正确，请重试</p>}
          <Button type="submit">查看文档</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>KnowledgeAI 文档分享</span>
          <Badge variant="secondary" className="ml-auto font-normal">
            {data.views} 次访问{data.maxViews ? ` / ${data.maxViews}` : ""}
          </Badge>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-6">
          <h1 className="break-all text-2xl font-bold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.type === "web" ? "网页链接" : formatSize(data.size)} · 上传于 {formatRelative(data.uploadedAt)}
            {data.expiresAt && ` · 有效期至 ${new Date(data.expiresAt).toLocaleDateString()}`}
          </p>
          <pre className="mt-5 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-4 font-mono text-sm leading-relaxed">
            {data.content || "（该文档暂无文本内容预览）"}
          </pre>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          由 KnowledgeAI 团队共享 · <Link href="/" className="underline">了解 KnowledgeAI</Link>
        </p>
      </div>
    </div>
  );
}
