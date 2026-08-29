"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// useSearchParams must sit inside a Suspense boundary when the page can be
// statically prerendered (Next 15+).
export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyForm />
    </React.Suspense>
  );
}

function VerifyForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // `email` + `demoUrl` come from the register redirect; `token` is the link
  // from the verification email itself.
  const email = (searchParams.get("email") ?? "").trim();
  const demoUrl = (searchParams.get("demoUrl") ?? "").trim();
  const verifyToken = (searchParams.get("token") ?? "").trim();

  const [checking, setChecking] = React.useState(Boolean(verifyToken));
  const [verified, setVerified] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [resendDemoUrl, setResendDemoUrl] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Consume the token from the emailed link on load.
  React.useEffect(() => {
    if (!verifyToken) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: verifyToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || t("page.verify-email.s8"));
          return;
        }
        setVerified(true);
      } catch {
        setError(t("page.verify-email.s8"));
      } finally {
        setChecking(false);
      }
    })();
  }, [verifyToken, t]);

  async function resend() {
    if (!email || resending) return;
    setResending(true);
    setError(null);
    setResent(false);
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.verify-email.s8"));
        return;
      }
      setResent(true);
      setCountdown(60);
      if (data.demoVerifyUrl) setResendDemoUrl(data.demoVerifyUrl);
    } catch {
      setError(t("page.verify-email.s8"));
    } finally {
      setResending(false);
    }
  }

  if (verified) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">{t("page.verify-email.s10")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("page.verify-email.s11")}</p>
        <Button variant="gradient" size="lg" className="mt-8 w-full" onClick={() => router.push("/dashboard")}>
          {t("page.verify-email.s5")}
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MailCheck className="h-8 w-8" />
      </div>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">{t("page.verify-email.s0")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t("page.verify-email.s2")} <span className="font-medium text-foreground">{email || "you@company.com"}</span>{" "}
        {t("page.verify-email.s3")}
        <br />
        {t("page.verify-email.s4")}
      </p>

      {(demoUrl || resendDemoUrl) && (
        <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-3 text-left">
          <p className="text-xs font-medium text-primary">{t("page.verify-email.s9")}</p>
          <a
            href={demoUrl || resendDemoUrl || ""}
            className="mt-1 block break-all text-xs text-primary underline underline-offset-2"
          >
            {demoUrl || resendDemoUrl}
          </a>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {checking ? (
        <Button variant="gradient" size="lg" className="mt-8 w-full" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      ) : (
        <div className="mt-8 space-y-3">
          <Button variant="gradient" size="lg" className="w-full" onClick={() => router.push("/dashboard")}>
            {t("page.verify-email.s5")}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={resend}
            disabled={countdown > 0 || resending}
          >
            {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {countdown > 0 ? t("page.verify-email.s1", { s: countdown }) : t("page.verify-email.s6")}
          </Button>
          {resent && <p className="text-xs text-success">{t("page.verify-email.s12")}</p>}
          <p className="text-xs text-muted-foreground">
            {t("page.verify-email.s7")} <span className="text-primary">{t("page.verify-email.s8")}</span>
          </p>
        </div>
      )}
    </div>
  );
}
