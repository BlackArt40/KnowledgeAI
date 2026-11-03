import { NextResponse } from "next/server";
import {
  getWorkspace,
  addWorkspaceMember,
  removeWorkspaceMember,
} from "@/lib/workspace/store";
import { findMemberByEmail } from "@/lib/team/store";
import { findUserByEmail } from "@/lib/auth/store";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resolve the workspace named in the request (defaults to the active one) and
 *  require the caller to be a member of it. */
async function loadWorkspace(req: Request, workspaceId?: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const ws = getWorkspace(workspaceId || u.workspaceId);
  if (!ws) return { error: NextResponse.json({ error: "工作区不存在" }, { status: 404 }) };
  if (!ws.members.includes(u.email)) {
    return { error: NextResponse.json({ error: "无权访问该工作区" }, { status: 403 }) };
  }
  return { u, ws };
}

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const r = await loadWorkspace(req, url.searchParams.get("workspaceId") ?? undefined);
  if ("error" in r) return r.error;
  const { u, ws } = r;
  const members = ws.members.map((email) => {
    const account = findUserByEmail(email);
    const member = findMemberByEmail(email);
    return {
      email,
      name: account?.name ?? member?.name ?? email,
      role: member?.role ?? null,
      status: member?.status ?? null,
    };
  });
  return NextResponse.json({
    workspace: { id: ws.id, name: ws.name, plan: ws.plan },
    members,
    canManage: ws.ownerId === u.id,
  });
}

/** POST /api/workspaces/members { workspaceId?, email } - owner adds a member. */
async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { workspaceId?: string; email?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const r = await loadWorkspace(req, body.workspaceId);
  if ("error" in r) return r.error;
  const { ws } = r;
  if (ws.ownerId !== u.id) {
    return NextResponse.json({ error: "权限不足：仅工作区所有者可管理成员" }, { status: 403 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  // Membership of the workspace is separate from team membership, but adding a
  // random address would create a tenant the recipient cannot use: require an
  // active team member.
  const member = findMemberByEmail(email);
  if (!member || member.status !== "active") {
    return NextResponse.json({ error: "该邮箱不是已加入团队的成员" }, { status: 400 });
  }
  if (ws.members.includes(email)) {
    return NextResponse.json({ error: "该成员已在工作区中" }, { status: 409 });
  }
  addWorkspaceMember(ws.id, email);
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "workspace.member_add",
    target: ws.name,
    detail: `添加工作区成员 ${email}`,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** DELETE /api/workspaces/members?workspaceId=&email= - owner removes. */
async function handleDELETE(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const r = await loadWorkspace(req, url.searchParams.get("workspaceId") ?? undefined);
  if ("error" in r) return r.error;
  const { ws } = r;
  if (ws.ownerId !== u.id) {
    return NextResponse.json({ error: "权限不足：仅工作区所有者可管理成员" }, { status: 403 });
  }
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (email === u.email.toLowerCase()) {
    return NextResponse.json({ error: "不能移除工作区所有者" }, { status: 400 });
  }
  if (!ws.members.includes(email)) {
    return NextResponse.json({ error: "该成员不在工作区中" }, { status: 404 });
  }
  removeWorkspaceMember(ws.id, email);
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "workspace.member_remove",
    target: ws.name,
    detail: `移除工作区成员 ${email}`,
  });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  return withApiTrace(req, "api /api/workspaces/members GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/workspaces/members POST", () => handlePOST(req));
}
export async function DELETE(req: Request) {
  return withApiTrace(req, "api /api/workspaces/members DELETE", () => handleDELETE(req));
}
