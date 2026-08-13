"use client";

import { useT, useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import {
  Shield, Smartphone, Monitor, LogOut, History, Download, Trash2,
  ShieldCheck, User, Bell, Cookie, AlertTriangle, Loader2, CheckCircle2, Bot,
  Copy, Check, Palette,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { formatRelative } from "@/lib/format";
import type { SecurityState, PrivacySettings } from "@/lib/security/types";
import { cn } from "@/lib/utils";
import { ModelSettings } from "@/components/app/model-settings";
import { ThemeSettings } from "@/components/app/theme-settings";
import { GoogleIcon, GithubIcon } from "@/components/icons/brand-icons";
import { oauthSignIn } from "@/lib/auth/oauth-signin";

// P3-2: OAuth providers shown in the social-accounts card (order + labels).
const OAUTH_PROVIDERS = ["google", "github"] as const;
const OAUTH_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };

const ROLE_BADGE: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

export default function SettingsPage() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [data, setData] = React.useState<(SecurityState & { twoFactorRequired?: boolean }) | null>(null);
  const [loading, setLoading] = React.useState(true);
  // P5-2: active tab, initialized from ?tab= (global search deep-link) and
  // kept in sync with the URL via history.replaceState.
  const [tab, setTab] = React.useState<string>(() => {
    if (typeof window === "undefined") return "security";
    return new URLSearchParams(window.location.search).get("tab") ?? "security";
  });

  // 2FA enrollment flow
  const [enrollOpen, setEnrollOpen] = React.useState(false);
  const [enrollData, setEnrollData] = React.useState<{ secret: string; qrCodeDataUrl: string; backupCodes: string[] } | null>(null);
  const [enrollCode, setEnrollCode] = React.useState("");
  const [enrollBusy, setEnrollBusy] = React.useState(false);
  const [enrollError, setEnrollError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  // 2FA disable flow
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableCode, setDisableCode] = React.useState("");
  const [disableBusy, setDisableBusy] = React.useState(false);
  const [disableError, setDisableError] = React.useState<string | null>(null);

  // P3-2: social login bindings (provider -> providerAccountId)
  const [oauthLinks, setOauthLinks] = React.useState<Record<string, string>>({});
  const [unbindProvider, setUnbindProvider] = React.useState<string | null>(null);
  const [unbindBusy, setUnbindBusy] = React.useState(false);
  const [unbindError, setUnbindError] = React.useState<string | null>(null);

  async function confirmUnbind() {
    if (!unbindProvider) return;
    setUnbindBusy(true);
    setUnbindError(null);
    try {
      const res = await fetch(`/api/auth/oauth/link?provider=${unbindProvider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setUnbindError(data.error || t("page.settings.s80"));
        return;
      }
      setOauthLinks(data.oauthLinks ?? {});
      setUnbindProvider(null);
    } catch {
      setUnbindError(t("page.settings.s80"));
    } finally {
      setUnbindBusy(false);
    }
  }

  // current authenticated user (profile tab)
  const [me, setMe] = React.useState<{ id: string; name: string; email: string; role: string; plan: string; oauthLinks?: Record<string, string> } | null>(null);
  const [profileName, setProfileName] = React.useState("");
  const [curPwd, setCurPwd] = React.useState("");
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [profileMsg, setProfileMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");

  // notification preferences
  const [notifPrefs, setNotifPrefs] = React.useState<{ emailDigest: boolean; kbReady: boolean; agentDone: boolean; securityAlert: boolean } | null>(null);
  const [savingNotif, setSavingNotif] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const d = await fetch("/api/security", { cache: "no-store" }).then((r) => r.json());
    setData(d);
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refresh(); }, [refresh]);

  const refreshUser = React.useCallback(async () => {
    const d = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
    if (d.user) {
      setMe(d.user);
      setProfileName(d.user.name);
      // P3-2: linked OAuth providers ride along on the user object.
      setOauthLinks(d.user.oauthLinks ?? {});
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refreshUser(); }, [refreshUser]);

  const refreshNotifPrefs = React.useCallback(async () => {
    const d = await fetch("/api/notifications/preferences", { cache: "no-store" }).then((r) => r.json());
    if (d.prefs) setNotifPrefs(d.prefs);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { refreshNotifPrefs(); }, [refreshNotifPrefs]);

  async function toggleNotif(key: "emailDigest" | "kbReady" | "agentDone" | "securityAlert", val: boolean) {
    if (!notifPrefs) return;
    setNotifPrefs({ ...notifPrefs, [key]: val });
    setSavingNotif(key);
    try {
      await fetch("/api/notifications/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: val }),
      });
    } catch { /* ignore */ }
    setSavingNotif(null);
  }

  async function saveProfile() {
    if (!me) return;
    setProfileMsg(null);
    if (newPwd && newPwd !== confirmPwd) {
      setProfileMsg({ ok: false, text: t("page.settings.s39") });
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
        setProfileMsg({ ok: false, text: d.error || t("page.settings.s40") });
      } else {
        setMe(d.user);
        setProfileName(d.user.name);
        if (d.token) localStorage.setItem("kai-token", d.token);
        setCurPwd(""); setNewPwd(""); setConfirmPwd("");
        setProfileMsg({ ok: true, text: t("page.settings.s41") });
      }
    } catch {
      setProfileMsg({ ok: false, text: t("page.settings.s42") });
    }
    setSavingProfile(false);
  }

  // ── 2FA enrollment (real TOTP flow) ────────────────────────────────────
  async function startEnroll() {
    setEnrollError(null);
    setEnrollData(null);
    setEnrollCode("");
    setEnrollOpen(true);
    try {
      const res = await fetch("/api/security/2fa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll" }),
      });
      const d = await res.json();
      if (!res.ok) { setEnrollError(d.error || t("page.settings.s43")); return; }
      setEnrollData({ secret: d.secret, qrCodeDataUrl: d.qrCodeDataUrl, backupCodes: d.backupCodes });
    } catch {
      setEnrollError(t("page.settings.s42"));
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrollError(null);
    if (!/^\d{6}$/.test(enrollCode.trim())) { setEnrollError(t("page.settings.s44")); return; }
    setEnrollBusy(true);
    try {
      const res = await fetch("/api/security/2fa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code: enrollCode.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setEnrollError(d.error || t("page.settings.s45")); return; }
      setEnrollOpen(false);
      await refresh();
    } catch {
      setEnrollError(t("page.settings.s42"));
    } finally {
      setEnrollBusy(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setDisableError(null);
    if (!disableCode.trim()) { setDisableError(t("page.settings.s46")); return; }
    setDisableBusy(true);
    try {
      const res = await fetch("/api/security/2fa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code: disableCode.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setDisableError(d.error || t("page.settings.s45")); return; }
      setDisableOpen(false);
      setDisableCode("");
      await refresh();
    } catch {
      setDisableError(t("page.settings.s42"));
    } finally {
      setDisableBusy(false);
    }
  }

  function copyBackupCodes() {
    if (!enrollData) return;
    void navigator.clipboard?.writeText(enrollData.backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch("/api/auth/me", { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        setProfileMsg({ ok: false, text: d.error || t("page.settings.s47") });
        setDeleting(false);
        return;
      }
      window.location.href = "/login";
    } catch {
      setProfileMsg({ ok: false, text: t("page.settings.s42") });
      setDeleting(false);
    }
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
        <h1 className="text-2xl font-bold tracking-tight">{t("page.settings.s0")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("page.settings.s1")}</p>
      </div>

      {/* P5-2: tab is URL-synced (?tab=security|profile|privacy|models|
          appearance) so global search results can deep-link to a settings
          section */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          const url = new URL(window.location.href);
          url.searchParams.set("tab", v);
          window.history.replaceState(null, "", url.toString());
        }}
      >
        <TabsList>
          <TabsTrigger value="security"><Shield className="h-4 w-4" />{t("page.settings.s0")}</TabsTrigger>
          <TabsTrigger value="profile"><User className="h-4 w-4" />{t("page.settings.s1")}</TabsTrigger>
          <TabsTrigger value="privacy"><Cookie className="h-4 w-4" />{t("page.settings.s2")}</TabsTrigger>
          <TabsTrigger value="models"><Bot className="h-4 w-4" />{t("page.settings.s3")}</TabsTrigger>
          {/* P5-5: appearance (theme) tab */}
          <TabsTrigger value="appearance"><Palette className="h-4 w-4" />{t("page.settings.s72")}</TabsTrigger>
        </TabsList>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          {/* 2FA */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />{t("page.settings.s4")}</span>
                <Badge variant={twoFactor.enabled ? "success" : "warning"}>
                  {twoFactor.enabled ? t("page.settings.s48") : t("page.settings.s49")}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                开启两步验证后，登录时需输入手机验证器（Google Authenticator / 1Password / Microsoft Authenticator）生成的动态验证码，为账户增加一层保护。
              </p>

              {twoFactor.enabled ? (
                <>
                  {twoFactor.enrolledAt && (
                    <p className="text-xs text-muted-foreground">
                      绑定时间：{formatRelative(twoFactor.enrolledAt)}
                    </p>
                  )}
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium">备用恢复码剩余：{twoFactor.backupCodesRemaining} 枚</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      恢复码在丢失验证器时使用，每枚仅可使用一次，使用后自动作废。绑定时仅显示一次，请妥善保存。
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => { setDisableError(null); setDisableCode(""); setDisableOpen(true); }}>
                    关闭两步验证
                  </Button>
                </>
              ) : (
                <>
                  {data.twoFactorRequired && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{t("page.settings.s7")}</span>
                    </div>
                  )}
                  <Button variant="gradient" onClick={startEnroll}>
                    <ShieldCheck className="h-4 w-4" /> 开启两步验证
                  </Button>
                </>
              )}

              {/* Enrollment dialog */}
              <Dialog open={enrollOpen} onOpenChange={(v) => { setEnrollOpen(v); if (!v) setEnrollError(null); }}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("page.settings.s8")}</DialogTitle>
                  </DialogHeader>
                  {enrollError && (
                    <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> {enrollError}
                    </p>
                  )}
                  {enrollData ? (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center">
                        <p className="mb-2 text-center text-xs text-muted-foreground">{t("page.settings.s9")}</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={enrollData.qrCodeDataUrl} alt={t("page.settings.s50")} width={180} height={180} className="rounded-lg border border-border bg-white p-1" />
                        <p className="mt-2 text-center text-xs text-muted-foreground">{t("page.settings.s10")}</p>
                        <code className="mt-1 max-w-full break-all rounded bg-muted px-2 py-1 text-center font-mono text-xs">{enrollData.secret}</code>
                      </div>
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-medium text-warning">{t("page.settings.s11")}</p>
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copyBackupCodes}>
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copied ? t("page.settings.s51") : t("page.settings.s52")}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {enrollData.backupCodes.map((c) => (
                            <code key={c} className="rounded bg-muted px-2 py-1 text-center font-mono text-xs">{c}</code>
                          ))}
                        </div>
                      </div>
                      <form className="space-y-2" onSubmit={confirmEnroll}>
                        <Label htmlFor="enroll-code" className="text-xs">{t("page.settings.s12")}</Label>
                        <Input id="enroll-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} className="text-center tracking-[0.3em]" required />
                        <Button type="submit" variant="gradient" className="w-full" disabled={enrollBusy}>
                          {enrollBusy && <Loader2 className="h-4 w-4 animate-spin" />} 完成绑定
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在生成验证密钥…
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              {/* Disable dialog */}
              <Dialog open={disableOpen} onOpenChange={(v) => { setDisableOpen(v); if (!v) setDisableError(null); }}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("page.settings.s13")}</DialogTitle>
                  </DialogHeader>
                  {disableError && (
                    <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> {disableError}
                    </p>
                  )}
                  <form className="space-y-3" onSubmit={confirmDisable}>
                    <p className="text-sm text-muted-foreground">{t("page.settings.s14")}</p>
                    <Input inputMode="numeric" autoComplete="one-time-code" placeholder={t("page.settings.s53")} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} autoFocus required />
                    <Button type="submit" variant="destructive" className="w-full" disabled={disableBusy}>
                      {disableBusy && <Loader2 className="h-4 w-4 animate-spin" />} 确认关闭
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* P3-2: social accounts (OAuth bindings) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />{t("page.settings.s73")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("page.settings.s74")}</p>
              {OAUTH_PROVIDERS.map((p) => {
                const linked = !!oauthLinks[p];
                return (
                  <div key={p} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      {p === "google" ? <GoogleIcon className="h-4 w-4" /> : <GithubIcon className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{OAUTH_LABEL[p]}</span>
                      {linked && <Badge variant="success" className="ml-2 text-[10px]">{t("page.settings.s75")}</Badge>}
                    </div>
                    {linked ? (
                      <Button size="sm" variant="outline" onClick={() => setUnbindProvider(p)}>
                        {t("page.settings.s76")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void oauthSignIn({
                            provider: p,
                            // bind mode: the bridge sees the existing session
                            // and links instead of logging in, then returns
                            // to this tab.
                            callbackUrl: "/api/auth/oauth/bridge?cb=%2Fsettings%3Ftab%3Dsecurity",
                          })
                        }
                      >
                        {t("page.settings.s77")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* P3-2: unbind confirmation */}
          <Dialog open={unbindProvider !== null} onOpenChange={(v) => { if (!v) { setUnbindProvider(null); setUnbindError(null); } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("page.settings.s78")}</DialogTitle>
              </DialogHeader>
              {unbindError && (
                <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {unbindError}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {unbindProvider ? t("page.settings.s79", { provider: OAUTH_LABEL[unbindProvider] ?? unbindProvider }) : ""}
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t("common.cancel")}</Button>
                </DialogClose>
                <Button variant="destructive" onClick={confirmUnbind} disabled={unbindBusy}>
                  {unbindBusy && <Loader2 className="h-4 w-4 animate-spin" />} {t("page.settings.s76")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><Monitor className="h-4 w-4" />{t("page.settings.s5")}</span>
                <Button size="sm" variant="ghost" onClick={revokeAll}>{t("page.settings.s16")}</Button>
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
                      {s.current && <Badge variant="success" className="text-[10px]">{t("page.settings.s17")}</Badge>}
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
              <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" />{t("page.settings.s6")}</CardTitle>
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
            <CardHeader><CardTitle>{t("page.settings.s3")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("page.settings.s19")}</Label>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t("page.settings.s54")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("page.settings.s20")}</Label>
                  <Input value={me?.email ?? ""} type="email" disabled />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{me ? (ROLE_BADGE[me.role] ?? me.role) : "—"}</Badge>
                <Badge variant="secondary" className="capitalize">{me?.plan ?? "—"}</Badge>
                <span className="text-xs text-muted-foreground">{t("page.settings.s21")}</span>
              </div>
              {/* P5-4: UI language preference, persisted to the user profile */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>{t("common.language")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("page.settings.langHint")}</p>
                </div>
                <Select
                  value={locale}
                  onValueChange={async (v) => {
                    setLocale(v as "zh-CN" | "en");
                    await fetch("/api/auth/me", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ locale: v }),
                    }).catch(() => {});
                  }}
                >
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{t("page.settings.s7")}</SelectItem>
                    <SelectItem value="en">{t("common.english")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>{t("page.settings.s22")}</Label>
                <Input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} placeholder={t("page.settings.s55")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("page.settings.s23")}</Label>
                  <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder={t("page.settings.s56")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("page.settings.s24")}</Label>
                  <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder={t("page.settings.s57")} />
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4" /> 通知偏好
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { k: "emailDigest" as const, label: t("page.settings.s58"), desc: t("page.settings.s59") },
                { k: "kbReady" as const, label: t("page.settings.s60"), desc: t("page.settings.s61") },
                { k: "agentDone" as const, label: t("page.settings.s62"), desc: t("page.settings.s63") },
                { k: "securityAlert" as const, label: t("page.settings.s64"), desc: t("page.settings.s65") },
              ].map((n) => (
                <div key={n.k} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{n.label}</p>
                    <p className="text-xs text-muted-foreground">{n.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {savingNotif === n.k && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    <Switch
                      checked={notifPrefs ? notifPrefs[n.k] : false}
                      onCheckedChange={(v) => toggleNotif(n.k, v)}
                      disabled={!notifPrefs}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Privacy / GDPR */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Cookie className="h-4 w-4" />{t("page.settings.s8")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "analytics" as const, label: t("page.settings.s66"), desc: t("page.settings.s67"), val: privacy.analytics },
                { key: "crashReports" as const, label: t("page.settings.s68"), desc: t("page.settings.s69"), val: privacy.crashReports },
                { key: "trainingOptIn" as const, label: t("page.settings.s70"), desc: t("page.settings.s71"), val: privacy.trainingOptIn },
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
                  <p className="text-sm font-medium">{t("page.settings.s26")}</p>
                  <p className="text-xs text-muted-foreground">{t("page.settings.s27")}</p>
                </div>
                <Select
                  value={String(privacy.dataRetentionDays)}
                  onValueChange={(v) => patchPrivacy({ dataRetentionDays: Number(v) })}
                >
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">{t("page.settings.s28")}</SelectItem>
                    <SelectItem value="60">{t("page.settings.s29")}</SelectItem>
                    <SelectItem value="90">{t("page.settings.s30")}</SelectItem>
                    <SelectItem value="180">{t("page.settings.s31")}</SelectItem>
                    <SelectItem value="365">{t("page.settings.s32")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("page.settings.s33")}</CardTitle></CardHeader>
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
                    <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />{t("page.settings.s9")}</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        此操作将永久删除您的账户、知识库、会话历史及所有相关数据，且<strong className="text-foreground">{t("page.settings.s35")}</strong>。
                      </p>
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                        ⚠️ 删除后您将无法登录，所有 API 密钥将立即失效。
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">{t("page.settings.s10")}<strong>DELETE</strong>{t("page.settings.s11")}</Label>
                        <Input
                          value={deleteConfirm}
                          onChange={(e) => setDeleteConfirm(e.target.value)}
                          placeholder="DELETE"
                          className="h-8"
                        />
                      </div>
                      {profileMsg && !profileMsg.ok && (
                        <p className="text-sm text-destructive">✗ {profileMsg.text}</p>
                      )}
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">{t("page.settings.s38")}</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={deleteAccount}
                        disabled={deleting || deleteConfirm !== "DELETE"}
                      >
                        {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                        确认永久删除
                      </Button>
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
        {/* P5-5: Appearance (theme mode / high contrast / brand color) */}
        <TabsContent value="appearance" className="space-y-4">
          <ThemeSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
