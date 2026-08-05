"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Forced 2FA enrollment: reached when an admin requires 2FA for the user's
// role but they haven't enrolled yet. A short-lived pre-auth token (stored in
// sessionStorage by the login page) authorizes enrollment without a session.
export default function TwoFactorEnrollPage() {
  const router = useRouter();
  const [preAuthToken] = React.useState<string | null>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem("kai-2fa-preauth") : null
  );
  const [email] = React.useState<string>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem("kai-2fa-email") || "" : ""
  );
  const [enrollData, setEnrollData] = React.useState<{
    secret: string;
    qrCodeDataUrl: string;
    backupCodes: string[];
  } | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // Enrollment auto-starts on mount, so begin in the loading state.
  const [loading, setLoading] = React.useState(true);
  const [phase, setPhase] = React.useState<"setup" | "verify">("setup");
  const [copied, setCopied] = React.useState(false);

  const startEnroll = React.useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/auth/2fa-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preAuthToken: token, action: "enroll" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "无法启动两步验证绑定");
        return;
      }
      setEnrollData({
        secret: data.secret,
        qrCodeDataUrl: data.qrCodeDataUrl,
        backupCodes: data.backupCodes,
      });
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { if (preAuthToken) void startEnroll(preAuthToken); else router.replace("/login"); }, [preAuthToken, startEnroll, router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位验证码");
      return;
    }
    if (!preAuthToken) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preAuthToken, action: "verify", code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "验证码不正确");
        return;
      }
      if (data.token) {
        sessionStorage.removeItem("kai-2fa-preauth");
        sessionStorage.removeItem("kai-2fa-email");
        localStorage.setItem("kai-token", data.token);
        router.push("/dashboard");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  function copyCodes() {
    if (!enrollData) return;
    void navigator.clipboard?.writeText(enrollData.backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">绑定两步验证</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          管理员已为你的账号角色开启两步验证强制策略，请先完成绑定才能登录。
          {email && <span className="block">当前账号：{email}</span>}
        </p>
      </div>

      {error && (
        <p className="mb-4 flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {phase === "setup" && (
        <div className="space-y-4">
          {loading && !enrollData ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在生成验证密钥…
            </div>
          ) : enrollData ? (
            <>
              <div className="flex flex-col items-center rounded-xl border border-border bg-card p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  使用验证器 App（Google Authenticator / 1Password / Microsoft Authenticator）扫描二维码
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollData.qrCodeDataUrl}
                  alt="两步验证二维码"
                  width={200}
                  height={200}
                  className="rounded-lg border border-border bg-white p-1"
                />
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  无法扫码？手动输入密钥：
                </p>
                <code className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                  {enrollData.secret}
                </code>
              </div>

              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-warning">备用恢复码（请妥善保存，每枚仅可使用一次）</p>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copyCodes}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {enrollData.backupCodes.map((c) => (
                    <code key={c} className="rounded bg-muted px-2 py-1 text-center font-mono text-xs">{c}</code>
                  ))}
                </div>
              </div>

              <Button variant="gradient" size="lg" className="w-full" onClick={() => setPhase("verify")}>
                <ShieldCheck className="h-4 w-4" /> 已扫码，下一步
              </Button>
            </>
          ) : null}
        </div>
      )}

      {phase === "verify" && (
        <form className="space-y-4" onSubmit={handleVerify}>
          <div className="space-y-2">
            <Label htmlFor="code">输入验证器显示的 6 位验证码</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
              className="text-center text-lg tracking-[0.3em]"
            />
          </div>
          <Button variant="gradient" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "验证中…" : "完成绑定并登录"}
          </Button>
          <button
            type="button"
            onClick={() => { setPhase("setup"); setCode(""); setError(null); }}
            className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            返回上一步
          </button>
        </form>
      )}
    </div>
  );
}
