"use client";

import { useT } from "@/lib/i18n/provider";
import { oauthSignIn } from "@/lib/auth/oauth-signin";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Loader2, Info, ShieldCheck, ArrowLeft } from "lucide-react";
import { GithubIcon, GoogleIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

function demoAccounts(t: (k: string) => string) {
  return [
  { email: "owner@knowledgeai.dev", role: "Owner", desc: t("page.login.s6") },
  { email: "admin@knowledgeai.dev", role: "Admin", desc: t("page.login.s7") },
  { email: "editor@knowledgeai.dev", role: "Editor", desc: t("page.login.s8") },
  { email: "viewer@knowledgeai.dev", role: "Viewer", desc: t("page.login.s9") },
];
};

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const [showPwd, setShowPwd] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [step, setStep] = React.useState<"credentials" | "2fa">("credentials");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // P3-2: configured OAuth providers (from Auth.js GET /api/auth/providers).
  // Buttons render only for configured providers; unconfigured ones stay
  // hidden instead of dead-ending at the provider.
  const [oauthProviders, setOauthProviders] = React.useState<string[]>([]);

  React.useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((p: Record<string, unknown>) => setOauthProviders(Object.keys(p)))
      .catch(() => setOauthProviders([]));
    // P3-2: OAuth flows land back here with ?error= (provider cancel /
    // configuration / link conflicts) - surface a friendly message.
    const oauthErr = new URLSearchParams(window.location.search).get("error");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (oauthErr === "oauth_link_conflict") setError(t("page.login.s24"));
    else if (oauthErr && oauthErr !== "Configuration") setError(t("page.login.s23"));
    else if (oauthErr === "Configuration") setError(t("page.login.s25"));
  }, [t]);

  // Step 1: verify email + password. The server responds with one of:
  //   { token }                  -> login complete
  //   { requires2FA: true }      -> ask for the TOTP / backup code (step 2)
  //   { mustEnroll2FA, preAuthToken } -> forced enrollment (redirect)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.login.s10"));
        return;
      }
      if (data.mustEnroll2FA) {
        // Admin requires 2FA for this role but it isn't set up yet.
        sessionStorage.setItem("kai-2fa-preauth", data.preAuthToken);
        sessionStorage.setItem("kai-2fa-email", email);
        router.push("/2fa-enroll");
        return;
      }
      if (data.requires2FA) {
        setStep("2fa");
        return;
      }
      if (data.token) {
        localStorage.setItem("kai-token", data.token);
        router.push("/dashboard");
      }
    } catch {
      setError(t("page.login.s11"));
    } finally {
      setLoading(false);
    }
  }

  // Step 2: submit the TOTP / backup code together with the credentials.
  async function handle2FA(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(totpCode.trim()) && !totpCode.trim().includes("-")) {
      setError(t("page.login.s12"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totpCode: totpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("page.login.s13"));
        return;
      }
      if (data.token) {
        localStorage.setItem("kai-token", data.token);
        router.push("/dashboard");
      } else {
        setError(t("page.login.s14"));
      }
    } catch {
      setError(t("page.login.s11"));
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(em: string) {
    setEmail(em);
    setPassword("password123");
  }

  if (step === "2fa") {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("page.login.s0")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("page.login.s26")}
          </p>
        </div>
        <form className="space-y-4" onSubmit={handle2FA}>
          <div className="space-y-2">
            <Label htmlFor="totp">{t("page.login.s1")}</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              autoFocus
              required
              className="text-center text-lg tracking-[0.3em]"
            />
            <p className="text-xs text-muted-foreground">
              {t("page.login.s27")}
            </p>
          </div>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? t("page.login.s15") : t("page.login.s16")}
          </Button>
          <button
            type="button"
            onClick={() => { setStep("credentials"); setTotpCode(""); setError(null); }}
            className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("page.login.s28")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("page.login.s2")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("page.login.s29")}
        </p>
      </div>

      {/* Demo accounts */}
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
          <Info className="h-3.5 w-3.5" /> {t("page.login.s30")}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {demoAccounts(t).map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => fillDemo(a.email)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            >
              <span className="font-medium text-foreground">{a.role}</span>
              <span className="block text-muted-foreground">{a.email}</span>
            </button>
          ))}
        </div>
      </div>

      {/* P3-2: social login - real OAuth 2.0 (Auth.js Authorization Code +
          PKCE). POST signin (GET is unsupported by Auth.js v5) via the
          oauthSignIn helper; the bridge mints the kai-token session. */}
      {oauthProviders.length > 0 && (
        <div className="grid gap-3">
          {oauthProviders.includes("google") && (
            <Button variant="outline" className="h-11" onClick={() => void oauthSignIn({ provider: "google" })}>
              <GoogleIcon className="h-4 w-4" />
              {t("page.login.s21")}
            </Button>
          )}
          {oauthProviders.includes("github") && (
            <Button variant="outline" className="h-11" onClick={() => void oauthSignIn({ provider: "github" })}>
              <GithubIcon className="h-4 w-4" />
              {t("page.login.s22")}
            </Button>
          )}
        </div>
      )}

      {oauthProviders.length > 0 && (
        <div className="my-6 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("page.login.s3")}</span>
          <Separator className="flex-1" />
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">{t("page.login.s4")}</Label>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("page.login.s5")}</Label>
            <Link
              href="/verify-email"
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("page.login.s31")}
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPwd ? t("page.login.s17") : t("page.login.s18")}
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {loading ? t("page.login.s19") : t("page.login.s20")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("page.login.s32")}{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {t("page.login.s33")}
        </Link>
      </p>
    </div>
  );
}
