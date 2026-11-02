import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import {
  createKbShare,
  getKbShareByKb,
  revokeKbShareByKb,
  sanitizeKbShare,
} from "@/lib/kb/kb-share";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
import { notifyManagers } from "@/lib/team/notify";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 共享与分发：整库只读公开链接（GET 查询 / POST 创建或替换 / DELETE 撤销）。
// 与文档分享同权限口径：能编辑该库即可分享（KB owner / editor / edit 权限），
// 跨租户一律 403（canEditKb 内含 workspace 边界）。

async function loadKb(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const kb = getKb(id);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  const allowed = canEditKb(kb.id, kb.name, u.id, kb.ownerId, {
    callerWorkspaceId: u.workspaceId,
    kbWorkspaceId: kb.workspaceId,
  });
  if (!allowed) return { error: NextResponse.json({ error: "无编辑权限" }, { status: 403 }) };
  return { u, kb };
}

// GET /api/knowledge-base/[id]/share — active link config (token + settings)
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadKb(req, id);
  if ("error" in r) return r.error;
  const share = getKbShareByKb(id);
  return NextResponse.json({ share: share ? sanitizeKbShare(share) : null });
}

// POST /api/knowledge-base/[id]/share
// { expiresAt?: number | null, password?: string | null, maxViews?: number | null }
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadKb(req, id);
  if ("error" in r) return r.error;

  let body: { expiresAt?: unknown; password?: unknown; maxViews?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  // expiresAt: epoch ms, or null/absent for "never"
  let expiresAt: number | undefined;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== "number" || !Number.isFinite(body.expiresAt)) {
      return NextResponse.json({ error: "expiresAt 必须是时间戳或 null" }, { status: 400 });
    }
    expiresAt = body.expiresAt;
  }

  // password: empty string clears it
  let password: string | undefined;
  if (body.password !== undefined && body.password !== null) {
    if (typeof body.password !== "string") {
      return NextResponse.json({ error: "password 必须是字符串" }, { status: 400 });
    }
    const pwd = body.password.trim();
    if (pwd.length > 128) {
      return NextResponse.json({ error: "密码最长 128 个字符" }, { status: 400 });
    }
    password = pwd || undefined;
  }

  // maxViews: positive integer, null/absent = unlimited
  let maxViews: number | undefined;
  if (body.maxViews !== undefined && body.maxViews !== null && body.maxViews !== "") {
    const n = Number(body.maxViews);
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json({ error: "maxViews 必须是正整数" }, { status: 400 });
    }
    maxViews = n;
  }

  const share = createKbShare({ kbId: id, createdBy: r.u.id, expiresAt, password, maxViews });
  recordAudit({
    actorId: r.u.id,
    actor: r.u.name,
    action: "sharelink.create",
    target: r.kb.name,
    detail: `创建知识库分享链接（${share.expiresAt ? "限时" : "永久"}${share.passwordHash ? " + 密码" : ""}${share.maxViews !== undefined ? `，最多 ${share.maxViews} 次` : ""}）`,
  });
  notifyManagers(
    {
      title: "知识库公开分享链接已创建",
      body: `${r.u.name} 为「${r.kb.name}」创建了公开分享链接`,
      link: "/team",
    },
    { exceptUserId: r.u.id }
  );
  return NextResponse.json({ share: sanitizeKbShare(share) }, { status: 201 });
}

// DELETE /api/knowledge-base/[id]/share — revoke the active link
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadKb(req, id);
  if ("error" in r) return r.error;
  const ok = revokeKbShareByKb(id);
  if (ok) {
    recordAudit({
      actorId: r.u.id,
      actor: r.u.name,
      action: "sharelink.revoke",
      target: r.kb.name,
      detail: "撤销知识库分享链接",
    });
    notifyManagers(
      {
        title: "知识库公开分享链接已撤销",
        body: `${r.u.name} 撤销了「${r.kb.name}」的公开分享链接`,
        link: "/team",
      },
      { exceptUserId: r.u.id }
    );
  }
  return NextResponse.json({ ok });
}
