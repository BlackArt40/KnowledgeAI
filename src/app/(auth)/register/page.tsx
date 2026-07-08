"use client";

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
  const router = useRouter();
  const [showPwd, setShowPwd] = React.useState(false);
  const [agree, setAgree] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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
        setError(data.error || "注册失败");
        return;
      }
      if (data.token) localStorage.setItem("kai-token", data.token);
      router.push("/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">创建账户</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          几分钟内开始构建你的第一个知识库
        </p>
      </div>

      <div className="grid gap-3">
        <Button variant="outline" className="h-11">
          <Google className="h-4 w-4" />
          使用 Google 继续
        </Button>
        <Button variant="outline" className="h-11">
          <Github className="h-4 w-4" />
          使用 GitHub 继续
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">或使用邮箱注册</span>
        <Separator className="flex-1" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">昵称</Label>
          <Input
            id="name"
            placeholder="你的名字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
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
          <Label htmlFor="password">密码</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete="new-password"
              placeholder="至少 8 位"
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
          {loading ? "创建中…" : "创建账户"}
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
