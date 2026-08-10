import { NextResponse } from "next/server";
import { listWorkspaces, getWorkspace, createWorkspace } from "@/lib/workspace/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// GET /api/workspaces - workspaces the current user is a member of.
// Returns each workspace with its plan + member count, and flags which one
// is currently active (the `kai-workspace` cookie).
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const workspaces = listWorkspaces(u.email).map((w) => ({
    id: w.id,
    name: w.name,
    plan: w.plan,
    memberCount: w.members.length,
    isOwner: w.ownerId === u.id,
    active: w.id === u.workspaceId,
  }));
  const current = getWorkspace(u.workspaceId);
  return NextResponse.json({ workspaces, currentWorkspace: u.workspaceId, currentName: current?.name ?? "" });
}

// POST /api/workspaces  { name, memberEmails? } - create a new workspace.
// The creator becomes the owner; optional member emails join immediately.
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { name?: string; memberEmails?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "工作区名称不能为空" }, { status: 400 });
  }
  const ws = createWorkspace({
    name: body.name,
    ownerId: u.id,
    ownerEmail: u.email,
    ownerName: u.name,
    memberEmails: Array.isArray(body.memberEmails) ? body.memberEmails : [],
  });
  return NextResponse.json({ workspace: ws }, { status: 201 });
}
