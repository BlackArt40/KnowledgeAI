"use client";

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
import { formatRelative } from "@/lib/format";
import { can, ROLE_ORDER } from "@/lib/team/rbac";
import {
  PERMISSIONS, ROLE_LABEL, ACCESS_LABEL,
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
  const [data, setData] = React.useState<TeamData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("members");
  const [myEmail, setMyEmail] = React.useState<string | null>(null);

  const fetchTeam = React.useCallback(async () => {
    try {
      const [teamRes, meRes] = await Promise.all([
        fetch("/api/team", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (teamRes.ok) setData(await teamRes.json());
      const me = await meRes.json();
      if (me.user) setMyEmail(me.user.email);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

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
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "members", label: "成员管理", icon: Users },
    { id: "shared", label: "共享知识库", icon: Library },
    { id: "matrix", label: "权限矩阵", icon: ShieldCheck },
    { id: "audit", label: "操作日志", icon: ScrollText },
  ];

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
              {stats.total} 位成员 · {stats.active} 活跃 · {stats.invited} 待接受
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <TeamSettingsDialog team={team} onSaved={(t) => setData((d) => d ? { ...d, team: t } : d)} />
          <InviteDialog onInvited={fetchTeam} />
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
            <span>成员</span><span>角色</span><span>状态</span><span>最近活跃</span><span />
          </div>
          <div className="divide-y divide-border">
            {members.map((m) => {
              const isOwner = m.role === "owner";
              const isSelf = myEmail !== null && m.email.toLowerCase() === myEmail.toLowerCase();
              return (
                <div key={m.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_140px_120px_120px_40px] md:items-center">
                  <div className="flex items-center gap-3">
                    <Avatar fallback={m.name.charAt(0)} className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {m.name}
                        {isSelf && <span className="text-[10px] text-muted-foreground">(你)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div>
                    {isOwner ? (
                      <Badge variant="default" className="gap-1"><Crown className="h-3 w-3" /> Owner</Badge>
                    ) : (
                      <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as Role)}>
                        <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div><StatusBadge status={m.status} /></div>
                  <div className="text-xs text-muted-foreground">{formatRelative(m.lastActiveAt)}</div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      disabled={isOwner || isSelf}
                      onClick={() => removeMember(m.id)}
                      aria-label="移除成员"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
          <p className="text-sm text-muted-foreground">设置团队共享知识库的访问权限。</p>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="divide-y divide-border">
              {sharedKbs.map((k) => (
                <div key={k.kbId} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Library className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{k.kbName}</p>
                    <p className="text-xs text-muted-foreground">{k.docs} 篇文档</p>
                  </div>
                  <Select value={k.access} onValueChange={(v) => changeAccess(k.kbId, v as KbAccess)}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">全员可读</SelectItem>
                      <SelectItem value="edit">成员可编辑</SelectItem>
                      <SelectItem value="private">仅 Owner/Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
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
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">能力</th>
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
            <p className="py-10 text-center text-sm text-muted-foreground">暂无操作记录</p>
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
  if (status === "active") return <Badge variant="success">在线</Badge>;
  if (status === "invited") return <Badge variant="warning">已邀请</Badge>;
  return <Badge variant="destructive">已停用</Badge>;
}
