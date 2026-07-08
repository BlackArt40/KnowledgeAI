"use client";
import * as React from "react";
import Link from "next/link";
import { Home, RefreshCw, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-destructive/20 blur-[100px]" />

      <Logo />

      <div className="relative mt-10 text-center">
        <p className="bg-gradient-to-br from-destructive to-amber-500 bg-clip-text text-8xl font-black tracking-tighter text-transparent sm:text-9xl">
          500
        </p>
        <h1 className="mt-4 text-xl font-semibold">服务器开小差了</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          抱歉，处理您的请求时发生了内部错误。我们的团队已收到通知，正在紧急修复。
        </p>
        {error.digest && (
          <p className="mt-3 inline-block rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            错误码：{error.digest}
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="gradient" onClick={reset}>
          <RefreshCw className="h-4 w-4" /> 重试
        </Button>
        <Button variant="outline" asChild>
          <Link href="/"><Home className="h-4 w-4" /> 返回首页</Link>
        </Button>
        <Button variant="ghost" asChild>
          <a href="mailto:support@knowledgeai.dev"><LifeBuoy className="h-4 w-4" /> 联系支持</a>
        </Button>
      </div>
    </div>
  );
}
