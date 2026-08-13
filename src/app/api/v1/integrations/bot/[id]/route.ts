import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import {
  getBotBinding,
  updateBotBinding,
  deleteBotBinding,
  auditBot,
} from "@/lib/integrations/bots";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// PATCH /api/v1/integrations/bot/[id] - rename / enable-disable a binding
async function handlePATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const bot = getBotBinding(id);
  if (!bot || bot.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "机器人不存在" }, { status: 404 });
  }
  let body: { name?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const updated = updateBotBinding(id, body);
  if (!updated) return NextResponse.json({ error: "更新失败" }, { status: 400 });
  auditBot(u.id, u.name, "bot.update", id, `active=${updated.active}`);
  const { tokenHash: _t, ...rest } = updated;
  return NextResponse.json({ bot: rest });
}

// DELETE /api/v1/integrations/bot/[id]
async function handleDELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const bot = getBotBinding(id);
  if (!bot || bot.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "机器人不存在" }, { status: 404 });
  }
  deleteBotBinding(id);
  auditBot(u.id, u.name, "bot.delete", id, "");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/integrations/bot PATCH", () => handlePATCH(req, ctx));
}
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/integrations/bot DELETE", () => handleDELETE(req, ctx));
}
