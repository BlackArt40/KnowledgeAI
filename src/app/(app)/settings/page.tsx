"use client";
import * as React from "react";
import {
  Shield, Smartphone, Monitor, LogOut, History, Download, Trash2,
  ShieldCheck, User, Bell, Cookie, AlertTriangle, Loader2, CheckCircle2, Bot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { formatRelative } from "@/lib/format";
import type { SecurityState, PrivacySettings } from "@/lib/security/types";
import { cn } from "@/lib/utils";
import { ModelSettings } from "@/components/app/model-settings";

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

export default function SettingsPage() {
  const [data, setData] = React.useState<SecurityState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  // current authenticated user (profile tab)
  const [me, setMe] = React.useState<{ id: string; name: string; email: string; role: string; plan: string } | null>(null);
  const [profileName, setProfileName] = React.useState("");
  const [curPwd, setCurPwd] = React.useState("");
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [profileMsg, setProfileMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const d = await fetch("/api/security", { cache: "no-store" }).then((r) => r.json());
    setData(d);
    setLoading(false);
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const refreshUser = React.useCallback(async () => {
    const d = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
    if (d.user) {
      setMe(d.user);
      setProfileName(d.user.name);
    }
  }, []);
  React.useEffect(() => { refreshUser(); }, [refreshUser]);

  async function saveProfile() {
    if (!me) return;
    setProfileMsg(null);
    if (newPwd && newPwd !== confirmPwd) {
      setProfileMsg({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          currentPassword: curPwd || undefined,
          newPassword: newPwd || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setProfileMsg({ ok: false, text: d.error || "保存失败" });
      } else {
        setMe(d.user);
        setProfileName(d.user.name);
        if (d.token) localStorage.setItem("kai-token", d.token);
        setCurPwd(""); setNewPwd(""); setConfirmPwd("");
        setProfileMsg({ ok: true, text: "保存成功" });
      }
    } catch {
      setProfileMsg({ ok: false, text: "网络错误，请重试" });
    }
    setSavingProfile(false);
  }

  async function toggle2FA(enable: boolean) {
    setBusy(true);
    await fetch("/api/security/2fa", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable, method: "app" }),
    });
    refresh();
    setBusy(false);
  }

  async function revokeSession(id: string) {
    await fetch(`/api/security/sessions/${id}`, { method: "DELETE" });
    refresh();
  }
  async function revokeAll() {
    await fetch("/api/security/sessions", { method: "DELETE" });
    refresh();
  }

  async function patchPrivacy(patch: Partial<PrivacySettings>) {
    await fetch("/api/security/privacy", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    refresh();
  }

  function exportData() {
    window.open("/api/security/export", "_blank");
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const { twoFactor, sessions, loginHistory, privacy } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理个人信息、安全设置与数据隐私。</p>
      </div>

      <Tabs defaultValue="security">
        <TabsList>
          <TabsTrigger value="security"><Shield className="h-4 w-4" /> 安全</TabsTrigger>
          <TabsTrigger value="profile"><User className="h-4 w-4" /> 个人信息</TabsTrigger>
          <TabsTrigger value="privacy"><Cookie className="h-4 w-4" /> 数据隐私</TabsTrigger>
          <TabsTrigger value="models"><Bot className="h-4 w-4" /> AI 模型</TabsTrigger>
        </TabsList>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          {/* 2FA */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> 两步验证（2FA）</span>
                <Badge variant={twoFactor.enabled ? "success" : "warning"}>
                  {twoFactor.enabled ? "已开启" : "未开启"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                开启两步验证后，登录时需输入手机验证器生成的动态验证码，为账户增加一层保护。
              </p>
              {twoFactor.enabled && twoFactor.backupCodes.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <p className="mb-2 text-xs font-medium text-warning">备用恢复码（每枚仅可使用一次）</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {twoFactor.backupCodes.map((c) => (
                      <code key={c} className="rounded bg-muted px-2 py-1 text-center font-mono text-xs">{c}</code>
                    ))}
                  </div>
                </div>
              )}
              <Button
                variant={twoFactor.enabled ? "outline" : "gradient"}
                onClick={() => toggle2FA(!twoFactor.enabled)}
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {twoFactor.enabled ? "关闭两步验证" : "开启两步验证"}
              </Button>
            </CardContent>
          </Card>

          {/* Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><Monitor className="h-4 w-4" /> 登录设备管理</span>
                <Button size="sm" variant="ghost" onClick={revokeAll}>退出其他设备</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    {s.device.includes("iPhone") || s.device.includes("iPad")
                      ? <Smartphone className="h-4 w-4" />
                      : <Monitor className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.device}</span>
                      {s.current && <Badge variant="success" className="text-[10px]">当前设备</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.browser} · {s.ip} · {s.location} · {formatRelative(s.lastActive)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => revokeSession(s.id)}>
                      <LogOut className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Login history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> 登录历史</CardTitle>
            </CardHeader>
            <CardContent className="max-h-64 overflow-y-auto">
              <div className="space-y-1">
                {loginHistory.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50">
                    {e.success
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                      : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                    <span className="flex-1 truncate">{e.device} · {e.location}</span>
                    <span className="font-mono text-muted-foreground">{e.ip}</span>
                    <span className="text-muted-foreground">{formatRelative(e.ts)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>个人信息</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>姓名</Label>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="你的姓名" />
                </div>
                <div className="space-y-2">
                  <Label>邮箱</Label>
                  <Input value={me?.email ?? ""} type="email" disabled />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{me ? (ROLE_BADGE[me.role] ?? me.role) : "—"}</Badge>
                <Badge variant="secondary" className="capitalize">{me?.plan ?? "—"}</Badge>
                <span className="text-xs text-muted-foreground">角色与套餐由管理员分配，邮箱不可修改</span>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>当前密码</Label>
                <Input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} placeholder="修改密码时需填写" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>新密码</Label>
                  <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="留空则不修改" />
                </div>
                <div className="space-y-2">
                  <Label>确认新密码</Label>
                  <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="再次输入新密码" />
                </div>
              </div>
              {profileMsg && (
                <p className={cn("text-sm", profileMsg.ok ? "text-primary" : "text-destructive")}>
                  {profileMsg.ok ? "✓ " : "✗ "}{profileMsg.text}
                </p>
              )}
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                保存更改
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> 通知偏好</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { k: "emailDigest", label: "每周用量摘要邮件", desc: "每周一收到上周的使用统计" },
                { k: "kbReady", label: "知识库处理完成通知", desc: "文档向量化完成时邮件提醒" },
                { k: "agentDone", label: "Agent 报告完成通知", desc: "调研报告生成完成时提醒" },
                { k: "securityAlert", label: "安全告警", desc: "异常登录或权限变更时立即通知" },
              ].map((n) => (
                <div key={n.k} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{n.label}</p>
                    <p className="text-xs text-muted-foreground">{n.desc}</p>
                  </div>
                  <Switch defaultChecked={n.k !== "emailDigest"} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Privacy / GDPR */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Cookie className="h-4 w-4" /> 数据与隐私设置</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "analytics" as const, label: "使用分析", desc: "允许收集匿名使用数据以改进产品", val: privacy.analytics },
                { key: "crashReports" as const, label: "崩溃报告", desc: "自动上报错误以帮助修复问题", val: privacy.crashReports },
                { key: "trainingOptIn" as const, label: "数据用于模型训练", desc: "允许将脱敏数据用于改进 AI 模型", val: privacy.trainingOptIn },
              ].map((p) => (
                <div key={p.key} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.desc}</p>
                  </div>
                  <Switch
                    checked={p.val}
                    onCheckedChange={(v) => patchPrivacy({ [p.key]: v })}
                  />
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">数据保留期限</p>
                  <p className="text-xs text-muted-foreground">超过此期限的会话与日志将自动清理</p>
                </div>
                <Badge variant="outline">{privacy.dataRetentionDays} 天</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>GDPR 数据权利</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                根据 GDPR（通用数据保护条例）与《个人信息保护法》，您有权访问、导出和删除您的个人数据。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={exportData}>
                  <Download className="h-4 w-4" /> 导出我的数据
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4" /> 删除账户与数据
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> 确认删除账户</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        此操作将永久删除您的账户、知识库、会话历史及所有相关数据，且<strong className="text-foreground">不可恢复</strong>。
                      </p>
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                        ⚠️ 删除后您将无法登录，所有 API 密钥将立即失效。
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline">取消</Button>
                      <Button variant="destructive">确认永久删除</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/* AI Models */}
        <TabsContent value="models" className="space-y-4">
          <ModelSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
