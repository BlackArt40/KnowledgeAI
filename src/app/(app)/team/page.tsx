"use client";

import { useT } from "@/lib/i18n/provider";


import * as React from "react";
import {
  Users, ShieldCheck, ScrollText, Library, Check, X, Trash2, Crown,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InviteDialog } from "@/components/app/team/invite-dialog";
import { TeamSettingsDialog } from "@/components/app/team/team-settings-dialog";
import { usePresence } from "@/components/app/presence-context";
import { formatRelative } from "@/lib/format";
import { can, ROLE_ORDER } from "@/lib/team/rbac";
import { ROLE_LABEL } from "@/lib/roles";
import {
  PERMISSIONS, ACCESS_LABEL,
  type Team, type Member, type AuditEntry, type KbAccessEntry, type Role, type KbAccess,
} from "@/lib/team/types";
import { cn } from "@/lib/utils";

type Tab = "members" | "shared" | "matrix" | "audit";

interface TeamData {
  team: Team;
  members: Member[];
  stats: { total: number; active: number; invited: number; owners: number };
  sharedKbs: KbAccessEntry[];
  audit: AuditEntry[];
}

export default function TeamPage() {
  const t = useT();
  const [data, setData] = React.useState<TeamData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("members");
  const [myEmail, setMyEmail] = React.useState<string | null>(null);
  const [myRole, setMyRole] = React.useState<Role | null>(null);
  // P4-1: live online/offline state (AppShell keeps a presence stream open).
  const { onlineUsers } = usePresence();

  const fetchTeam = React.useCallback(async () => {
    try {
      const [teamRes, meRes] = await Promise.all([
        fetch("/api/team", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (teamRes.ok) setData(await teamRes.json());
      const me = await meRes.json();
      if (me.user) {
        setMyEmail(me.user.email);
        setMyRole(me.user.role as Role);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { fetchTeam(); }, [fetchTeam]);

  async function changeRole(id: string, role: Role) {
    setData((d) => d ? { ...d, members: d.members.map((m) => m.id === id ? { ...m, role } : m) } : d);
    await fetch(`/api/team/members/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    fetchTeam();
  }

  async function removeMember(id: string) {
    setData((d) => d ? { ...d, members: d.members.filter((m) => m.id !== id) } : d);
    await fetch(`/api/team/members/${id}`, { method: "DELETE" });
    fetchTeam();
  }

  async function changeAccess(kbId: string, access: KbAccess) {
    setData((d) => d ? { ...d, sharedKbs: d.sharedKbs.map((k) => k.kbId === kbId ? { ...k, access } : k) } : d);
    await fetch("/api/team/kb-access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kbId, access }) });
  }

  // P4-2: per-member role override on a KB (owner only).
  async function changeMemberRole(kbId: string, email: string, role: "editor" | "viewer" | null) {
    setData((d) => d ? { ...d, sharedKbs: d.sharedKbs.map((k) => {
      if (k.kbId !== kbId) return k;
      const roles = { ...(k.memberRoles ?? {}) };
      if (role === null) delete roles[email];
      else roles[email] = role;
      return { ...k, memberRoles: roles };
    }) } : d);
    await fetch("/api/team/kb-access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kbId, email, role }) });
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-10 w-96 rounded-lg" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const { team, members, stats, sharedKbs, audit } = data;
  const canManage = myRole ? can(myRole, "member.manage") : false;
  const canInvite = myRole ? can(myRole, "member.invite") : false;
  const canSettings = myRole ? can(myRole, "team.settings") : false;
  const allTabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "members", label: t("page.team.tabMembers"), icon: Users },
    { id: "shared", label: t("page.team.tabShared"), icon: Library },
    { id: "matrix", label: t("page.team.tabMatrix"), icon: ShieldCheck },
    { id: "audit", label: t("page.team.tabAudit"), icon: ScrollText },
  ];
  // Audit log is restricted to managers; hide the tab for everyone else.
  const tabs = canManage ? allTabs : allTabs.filter((t) => t.id !== "audit");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar fallback={team.logoInitial} className="h-14 w-14 bg-brand-gradient text-xl text-white" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {team.name}
              <Badge variant="default">{team.plan}</Badge>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("page.team.s25", { total: stats.total, active: stats.active, invited: stats.invited })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canSettings && <TeamSettingsDialog team={team} onSaved={(t) => setData((d) => d ? { ...d, team: t } : d)} />}
          {canInvite && <InviteDialog onInvited={fetchTeam} />}
        </div>
      </div>

      {/* tabs */}
      <div className="flex w-full overflow-x-auto rounded-lg border border-border bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* members */}
      {tab === "members" && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="hidden grid-cols-[1fr_140px_120px_120px_40px] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
            <span>{t("page.team.member")}</span><span>{t("page.team.role")}</span><span>{t("page.team.status")}</span><span>{t("page.team.recentActive")}</span><span />
          </div>
          <div className="divide-y divide-border">
            {members.map((m) => {
              const isOwner = m.role === "owner";
              const isSelf = myEmail !== null && m.email.toLowerCase() === myEmail.toLowerCase();
              const isOnline = onlineUsers.some((u) => u.email.toLowerCase() === m.email.toLowerCase());
              return (
                <div key={m.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_140px_120px_120px_40px] md:items-center">
                  <div className="flex items-center gap-3">
                    <Avatar fallback={m.name.charAt(0)} className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {m.name}
                        {isSelf && <span className="text-[10px] text-muted-foreground">{t("page.team.selfMarker")}</span>}
                        {isOnline && (
                          <span
                            className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                            title={t("page.team.online")}
                          />
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div>
                    {isOwner ? (
                      <Badge variant="default" className="gap-1"><Crown className="h-3 w-3" /> Owner</Badge>
                    ) : canManage ? (
                      <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as Role)}>
                        <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={m.status} />
                    {isOnline && (
                      <Badge variant="success" className="px-1.5 text-[10px]">{t("page.team.online")}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{formatRelative(m.lastActiveAt)}</div>
                  <div className="flex justify-end">
                    {canManage && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                        disabled={isOwner || isSelf}
                        onClick={() => removeMember(m.id)}
                        aria-label={t("page.team.removeMember")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* shared kbs */}
      {tab === "shared" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {canManage ? t("page.team.setSharedAccess") : t("page.team.sharedAccessInfo")}
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="divide-y divide-border">
              {sharedKbs.map((k) => {
                const roles = k.memberRoles ?? {};
                const roleEmails = Object.keys(roles);
                const candidates = members.filter((m) => m.role !== "owner" && m.status === "active");
                return (
                  <div key={k.kbId} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Library className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {k.kbName}
                          {k.isOwner && <span className="ml-2 text-[10px] font-normal text-muted-foreground">{t("page.team.mineMarker")}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("page.team.s26", { owner: k.ownerName, docs: k.docs })}
                        </p>
                      </div>
                      {canManage ? (
                        <Select value={k.access} onValueChange={(v) => changeAccess(k.kbId, v as KbAccess)}>
                          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view">{t("page.team.everyoneRead")}</SelectItem>
                            <SelectItem value="edit">{t("page.team.memberEditable")}</SelectItem>
                            <SelectItem value="private">{t("page.team.onlyOwnerAdmin")}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{ACCESS_LABEL[k.access]}</Badge>
                      )}
                    </div>
                    {/* P4-2: per-member role overrides (KB owner only) */}
                    {k.isOwner && canManage && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-1">
                        <span className="text-[11px] text-muted-foreground">{t("page.team.memberPermLabel")}</span>
                        {roleEmails.map((email) => {
                          const m = members.find((x) => x.email === email);
                          return (
                            <span key={email} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]">
                              {m?.name ?? email}
                              <span className="text-muted-foreground">· {roles[email] === "editor" ? "Editor" : "Viewer"}</span>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => changeMemberRole(k.kbId, email, null)}
                                aria-label={t("page.team.s24")}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                        {candidates.length > 0 && (
                          <Select
                            value=""
                            onValueChange={(v) => changeMemberRole(k.kbId, v, "viewer")}
                          >
                            <SelectTrigger className="h-6 w-[130px] text-[11px]">
                              <SelectValue placeholder={t("page.team.addMemberPh")} />
                            </SelectTrigger>
                            <SelectContent>
                              {candidates.map((m) => (
                                <SelectItem key={m.id} value={m.email}>{t("page.team.s27", { name: m.name, role: ROLE_LABEL[m.role] })}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* permission matrix */}
      {tab === "matrix" && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("page.team.capability")}</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r} className="px-4 py-3 text-center font-medium text-muted-foreground">{ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{p.label}</td>
                    {ROLE_ORDER.map((r) => {
                      const ok = can(r, p.key);
                      return (
                        <td key={r} className="px-4 py-3 text-center">
                          {ok ? (
                            <Check className="mx-auto h-4 w-4 text-success" />
                          ) : (
                            <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* audit */}
      {tab === "audit" && (
        <div className="rounded-2xl border border-border bg-card p-2">
          {audit.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("page.team.noAudit")}</p>
          ) : (
            <div className="space-y-0">
              {audit.map((a, i) => (
                <div key={a.id} className="relative flex gap-3 px-3 py-3">
                  {i < audit.length - 1 && <span className="absolute left-[22px] top-9 h-[calc(100%-1rem)] w-px bg-border" />}
                  <span className="z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {a.actor.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{a.actor}</span>
                      <span className="text-muted-foreground"> {a.action} </span>
                      <span className="font-medium">{a.target}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  const t = useT();
  if (status === "active") return <Badge variant="success">{t("page.team.online")}</Badge>;
  if (status === "invited") return <Badge variant="warning">{t("page.team.invited")}</Badge>;
  return <Badge variant="destructive">{t("page.team.banned")}</Badge>;
}
