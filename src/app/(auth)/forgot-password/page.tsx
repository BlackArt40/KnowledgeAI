"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [demoUrl, setDemoUrl] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.forgot-password.s0"));
        return;
      }
      setSubmitted(true);
      if (data.demoResetUrl) setDemoUrl(data.demoResetUrl);
    } catch {
      setError(t("page.forgot-password.s0"));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("page.forgot-password.s5")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("page.forgot-password.s6")}</p>
        </div>
        {demoUrl && (
          <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary">{t("page.forgot-password.s7")}</p>
            <a
              href={demoUrl}
              className="mt-1 block break-all text-xs text-primary underline underline-offset-2"
            >
              {demoUrl}
            </a>
          </div>
        )}
        <Button variant="outline" className="w-full" asChild>
          <Link href="/login">
            <ArrowLeft className="h-4 w-4" /> {t("page.forgot-password.s4")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("page.forgot-password.s0")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("page.forgot-password.s1")}</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">{t("page.forgot-password.s2")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {loading ? t("page.forgot-password.s8") : t("page.forgot-password.s3")}
        </Button>
      </form>

      <p className="mt-6 text-center">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("page.forgot-password.s4")}
        </Link>
      </p>
    </div>
  );
}