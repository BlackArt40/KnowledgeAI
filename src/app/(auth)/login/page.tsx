"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, Mail } from "lucide-react";
import { GithubIcon, GoogleIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";


export default function LoginPage() {
  const [showPwd, setShowPwd] = React.useState(false);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">欢迎回来</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          登录你的 KnowledgeAI 工作台
        </p>
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

      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
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
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPwd ? "隐藏密码" : "显示密码"}
            >
              {showPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <Button variant="gradient" size="lg" className="w-full">
          <Mail className="h-4 w-4" />
          登录
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        还没有账户？{" "}
        <Link
          href="/register"
          className="font-medium text-primary hover:underline"
        >
          免费注册
        </Link>
      </p>
    </div>
  );
}
