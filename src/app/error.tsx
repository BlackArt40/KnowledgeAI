"use client";
import * as React from "react";
import { useT } from "@/lib/i18n/provider";
import Link from "next/link";
import { Home, RefreshCw, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { clientLog } from "@/lib/obs/log-browser";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  React.useEffect(() => {
    clientLog.error({ err: { message: error.message || "Page render error", stack: error.stack ?? "" } }, "page render error");
    // P6-1: report render errors to the observability endpoint (which
    // forwards to Sentry when SENTRY_DSN is configured).
    void fetch("/api/obs/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message || "Page render error",
        stack: error.stack,
        source: "error.tsx",
        url: window.location.href,
        tags: { digest: error.digest ?? "unknown" },
      }),
      keepalive: true,
    }).catch(() => {});
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
        <h1 className="mt-4 text-xl font-semibold">{t("page.error.s0")}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {t("page.error.s3")}
        </p>
        {error.digest && (
          <p className="mt-3 inline-block rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {t("page.error.s4", { code: error.digest })}
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="gradient" onClick={reset}>
          <RefreshCw className="h-4 w-4" /> {t("page.error.s5")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/"><Home className="h-4 w-4" />{t("page.error.s1")}</Link>
        </Button>
        <Button variant="ghost" asChild>
          <a href="mailto:support@knowledgeai.dev"><LifeBuoy className="h-4 w-4" />{t("page.error.s2")}</a>
        </Button>
      </div>
    </div>
  );
}
