import { NextResponse } from "next/server";
import { findMemberByEmail, inviteMember } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can, isRole, outranks } from "@/lib/team/rbac";
import { notifyMember, roleLabel } from "@/lib/team/notify";
import { INVITE_TTL_MS, signInviteToken } from "@/lib/team/invite-token";
import { listPendingInviteEmails, reserveInviteSeat } from "@/lib/team/invite-seats";
import { getWorkspace } from "@/lib/workspace/store";
import { getPlan } from "@/lib/billing/plans";
import { isEmailEnabled, sendInviteEmail } from "@/lib/email";
import { EMAIL_RE } from "@/lib/validation/email";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// POST /api/team/invite  { name?, email, role }  (owner/admin only)
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role, "member.invite")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可邀请成员" }, { status: 403 });
  }

  let body: { name?: string; email?: string; role?: Role };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const email = (body.email?.trim() ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });

  const role: Role = body.role ?? "viewer";
  if (!isRole(role)) return NextResponse.json({ error: "角色不正确" }, { status: 400 });
  // A manager can only hand out roles below their own rank. Owner is
  // deliberately excluded: the team stays single-owner until an explicit
  // ownership-transfer flow exists, otherwise the extra owner is unremovable.
  if (role === "owner") {
    return NextResponse.json({ error: "团队只能有一个 Owner，暂不支持邀请新 Owner" }, { status: 403 });
  }
  if (!outranks(u.role, role)) {
    return NextResponse.json({ error: "权限不足：不能邀请与自己相同或更高角色的成员" }, { status: 403 });
  }
  if (findMemberByEmail(email)) {
    return NextResponse.json({ error: "该邮箱已在团队中" }, { status: 409 });
  }

  // Seats are a plan limit (free=1 / pro=10 / enterprise=unlimited) on the
  // CURRENT workspace: count only its members, not the global team roster
  // (a free personal tenant would otherwise look full because of seed members).
  // Pending invites are not attached to a workspace until accepted.
  const ws = getWorkspace(u.workspaceId);
  const seats = getPlan(ws?.plan ?? "free").seats;
  if (seats !== null && ws) {
    const usedEmails = new Set(ws.members.map((m) => m.toLowerCase()));
    // Pending invitations reserve a seat until accepted/rejected: stateless
    // tokens cannot be listed, so the reservation is tracked separately.
    for (const pending of listPendingInviteEmails(ws.id)) usedEmails.add(pending);
    const used = usedEmails.size;
    if (used >= seats) {
      return NextResponse.json(
        { error: `当前套餐席位已满（${used}/${seats}），请升级套餐后再邀请`, code: "seats_full" },
        { status: 409 }
      );
    }
  }

  const member = inviteMember({ name: body.name ?? "", email, role }, u.name);
  reserveInviteSeat(u.workspaceId, email, role, Date.now() + INVITE_TTL_MS);
  const token = signInviteToken({ email, role, workspaceId: u.workspaceId });
  const inviteUrl = `${new URL(req.url).origin}/invite?token=${encodeURIComponent(token)}`;
  const mail = await sendInviteEmail(email, inviteUrl, u.name);
  notifyMember(
    email,
    {
      title: "你已被邀请加入团队",
      body: `${u.name} 邀请你以 ${roleLabel(role)} 角色加入团队`,
      link: "/team",
    },
    { exceptUserId: u.id }
  );
  // Demo fallback (no RESEND configured): return the link so the flow can be
  // completed without a mail account, mirroring forgot-password.
  return NextResponse.json(
    {
      member,
      emailSent: mail.ok,
      inviteUrl: isEmailEnabled() ? undefined : inviteUrl,
    },
    { status: 201 }
  );
}
