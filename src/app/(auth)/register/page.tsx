"use client";

import { useT } from "@/lib/i18n/provider";
import { oauthSignIn } from "@/lib/auth/oauth-signin";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { GithubIcon as Github, GoogleIcon as Google } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const [showPwd, setShowPwd] = React.useState(false);
  const [agree, setAgree] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // P3-2: configured OAuth providers (Auth.js). OAuth sign-up goes through
  // the same bridge as login - a new identity auto-creates the account.
  const [oauthProviders, setOauthProviders] = React.useState<string[]>([]);

  React.useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((p: Record<string, unknown>) => setOauthProviders(Object.keys(p)))
      .catch(() => setOauthProviders([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agree) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.register.s5"));
        return;
      }
      if (data.token) localStorage.setItem("kai-token", data.token);
      router.push("/dashboard");
    } catch {
      setError(t("page.register.s6"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("page.register.s0")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          几分钟内开始构建你的第一个知识库
        </p>
      </div>

      {oauthProviders.length > 0 && (
        <div className="grid gap-3">
          {oauthProviders.includes("google") && (
            <Button variant="outline" className="h-11" onClick={() => void oauthSignIn({ provider: "google" })}>
              <Google className="h-4 w-4" />
              {t("page.register.s12")}
            </Button>
          )}
          {oauthProviders.includes("github") && (
            <Button variant="outline" className="h-11" onClick={() => void oauthSignIn({ provider: "github" })}>
              <Github className="h-4 w-4" />
              {t("page.register.s13")}
            </Button>
          )}
        </div>
      )}

      {oauthProviders.length > 0 && (
        <div className="my-6 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("page.register.s1")}</span>
          <Separator className="flex-1" />
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">{t("page.register.s2")}</Label>
          <Input
            id="name"
            placeholder={t("page.register.s7")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("page.register.s3")}</Label>
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
        <div className="space-y-2">
          <Label htmlFor="password">{t("page.register.s4")}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete="new-password"
              placeholder={t("page.register.s8")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPwd ? t("page.register.s9") : t("page.register.s10")}
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
          />
          <span className="text-muted-foreground">
            我已阅读并同意{" "}
            <Link href="/terms" className="text-primary hover:underline">
              服务条款
            </Link>{" "}
            与{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              隐私政策
            </Link>
          </span>
        </label>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          variant="gradient"
          size="lg"
          className="w-full"
          disabled={!agree || loading}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? t("page.register.s11") : t("page.register.s0")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        已有账户？{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          登录
        </Link>
      </p>
    </div>
  );
}
