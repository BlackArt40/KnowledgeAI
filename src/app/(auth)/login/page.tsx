"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Loader2, Info, ShieldCheck, ArrowLeft } from "lucide-react";
import { GithubIcon, GoogleIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const DEMO_ACCOUNTS = [
  { email: "owner@knowledgeai.dev", role: "Owner", desc: "全部权限" },
  { email: "admin@knowledgeai.dev", role: "Admin", desc: "管理成员+KB" },
  { email: "editor@knowledgeai.dev", role: "Editor", desc: "编辑+问答+Agent" },
  { email: "viewer@knowledgeai.dev", role: "Viewer", desc: "只读+问答" },
];

export default function LoginPage() {
  const router = useRouter();
  const [showPwd, setShowPwd] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [step, setStep] = React.useState<"credentials" | "2fa">("credentials");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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
        setError(data.error || "登录失败");
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
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // Step 2: submit the TOTP / backup code together with the credentials.
  async function handle2FA(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(totpCode.trim()) && !totpCode.trim().includes("-")) {
      setError("请输入 6 位验证码或恢复码");
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
        setError(data.error || "验证失败");
        return;
      }
      if (data.token) {
        localStorage.setItem("kai-token", data.token);
        router.push("/dashboard");
      } else {
        setError("验证失败，请重试");
      }
    } catch {
      setError("网络错误，请重试");
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
          <h1 className="text-2xl font-bold tracking-tight">两步验证</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请输入验证器 App 生成的 6 位动态验证码，或使用备用恢复码。
          </p>
        </div>
        <form className="space-y-4" onSubmit={handle2FA}>
          <div className="space-y-2">
            <Label htmlFor="totp">验证码</Label>
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
              恢复码格式为 XXXX-XXXX，每枚仅可使用一次。
            </p>
          </div>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "验证中…" : "验证并登录"}
          </Button>
          <button
            type="button"
            onClick={() => { setStep("credentials"); setTotpCode(""); setError(null); }}
            className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 返回重新输入账号
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">欢迎回来</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          登录你的 KnowledgeAI 工作台
        </p>
      </div>

      {/* Demo accounts */}
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
          <Info className="h-3.5 w-3.5" /> 演示账号（密码均为 password123）
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {DEMO_ACCOUNTS.map((a) => (
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

      <div className="grid gap-3">
        <Button variant="outline" className="h-11">
          <GoogleIcon className="h-4 w-4" />
          使用 Google 继续
        </Button>
        <Button variant="outline" className="h-11">
          <GithubIcon className="h-4 w-4" />
          使用 GitHub 继续
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">或使用邮箱</span>
        <Separator className="flex-1" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
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
            <Label htmlFor="password">密码</Label>
            <Link
              href="/verify-email"
              className="text-xs font-medium text-primary hover:underline"
            >
              忘记密码？
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
              aria-label={showPwd ? "隐藏密码" : "显示密码"}
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
          {loading ? "登录中…" : "登录"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        还没有账户？{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          免费注册
        </Link>
      </p>
    </div>
  );
}
