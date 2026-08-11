import { NextResponse } from "next/server";
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
} from "@/lib/workspace/store";
import { getRequestUser } from "@/lib/auth/guard";
import { isValidBrandColor, DEFAULT_BRAND_COLOR } from "@/lib/theme/brand-colors";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/workspaces - workspaces the current user is a member of.
// Returns each workspace with its plan + member count, and flags which one
// is currently active (the `kai-workspace` cookie).
async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const workspaces = listWorkspaces(u.email).map((w) => ({
    id: w.id,
    name: w.name,
    plan: w.plan,
    memberCount: w.members.length,
    isOwner: w.ownerId === u.id,
    active: w.id === u.workspaceId,
    // P5-5: theme brand color (drives the workspace-level CSS variables).
    brandColor: w.brandColor ?? DEFAULT_BRAND_COLOR,
  }));
  const current = getWorkspace(u.workspaceId);
  return NextResponse.json({
    workspaces,
    currentWorkspace: u.workspaceId,
    currentName: current?.name ?? "",
    currentBrandColor: current?.brandColor ?? DEFAULT_BRAND_COLOR,
  });
}

// POST /api/workspaces  { name, memberEmails? } - create a new workspace.
// The creator becomes the owner; optional member emails join immediately.
async function handlePOST(req: Request) {
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

// PATCH /api/workspaces  { brandColor } - workspace-level theme settings.
// Only the workspace owner may change them (403 otherwise); the value must be
// one of the curated palette (400 otherwise). Audited as `workspace.update`.
async function handlePATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { brandColor?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const brandColor = body.brandColor;
  if (typeof brandColor !== "string" || !isValidBrandColor(brandColor)) {
    return NextResponse.json({ error: "无效的品牌色" }, { status: 400 });
  }
  const ws = getWorkspace(u.workspaceId);
  if (!ws) return NextResponse.json({ error: "工作区不存在" }, { status: 404 });
  if (ws.ownerId !== u.id) {
    return NextResponse.json({ error: "仅工作区所有者可修改主题设置" }, { status: 403 });
  }
  const prev = ws.brandColor ?? DEFAULT_BRAND_COLOR;
  const updated = updateWorkspace(ws.id, { brandColor });
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "workspace.update",
    target: ws.name,
    detail: `工作区品牌色由 ${prev} 调整为 ${brandColor}`,
  });
  return NextResponse.json({ workspace: updated });
}

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/workspaces GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/workspaces POST", () => handlePOST(req));
}
export async function PATCH(req: Request) {
  return withApiTrace(req, "api /api/workspaces PATCH", () => handlePATCH(req));
}
