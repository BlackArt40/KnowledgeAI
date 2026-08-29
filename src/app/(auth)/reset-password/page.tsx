"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// useSearchParams must sit inside a Suspense boundary when the page can be
// statically prerendered (Next 15+).
export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetForm />
    </React.Suspense>
  );
}

function ResetForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("page.reset-password.s7"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.reset-password.s0"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("page.reset-password.s0"));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("page.reset-password.s4")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("page.reset-password.s5")}</p>
        </div>
        <Button variant="gradient" size="lg" className="w-full" asChild>
          <Link href="/login">{t("page.reset-password.s6")}</Link>
        </Button>
      </div>
    );
  }

  // Missing token = broken / already-used link: don't render a form that can
  // only fail on submit - show the dead-link state and a way to re-request.
  if (!token) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("page.reset-password.s9")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("page.reset-password.s10")}</p>
        </div>
        <Button variant="gradient" size="lg" className="w-full" asChild>
          <Link href="/forgot-password">{t("page.reset-password.s11")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("page.reset-password.s0")}</h1>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="password">{t("page.reset-password.s1")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("page.reset-password.s2")}</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {loading ? t("page.reset-password.s8") : t("page.reset-password.s3")}
        </Button>
      </form>
    </div>
  );
}