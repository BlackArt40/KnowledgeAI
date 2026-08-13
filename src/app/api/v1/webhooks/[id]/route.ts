import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import {
  getWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  isValidWebhookUrl,
  listDeliveryRecords,
  auditWebhook,
} from "@/lib/webhooks/store";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/types";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// PATCH /api/v1/webhooks/[id] - update name/url/secret/events/active
async function handlePATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const sub = getWebhookSubscription(id);
  if (!sub || sub.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "Webhook 不存在" }, { status: 404 });
  }

  let body: { name?: string; url?: string; secret?: string; events?: string[]; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (body.url !== undefined && !isValidWebhookUrl(body.url)) {
    return NextResponse.json({ error: "Webhook 地址必须是 http/https URL" }, { status: 400 });
  }
  if (body.events !== undefined) {
    const events = body.events as WebhookEvent[];
    if (events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
      return NextResponse.json({ error: "events 非法" }, { status: 400 });
    }
  }

  const updated = updateWebhookSubscription(id, {
    ...body,
    events: body.events as WebhookEvent[] | undefined,
  });
  if (!updated) return NextResponse.json({ error: "更新失败" }, { status: 400 });
  auditWebhook(u.id, u.name, "webhook.update", id, `active=${updated.active}`);
  return NextResponse.json({ webhook: updated });
}

// DELETE /api/v1/webhooks/[id]
async function handleDELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const sub = getWebhookSubscription(id);
  if (!sub || sub.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "Webhook 不存在" }, { status: 404 });
  }
  deleteWebhookSubscription(id);
  auditWebhook(u.id, u.name, "webhook.delete", id, "");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/webhooks PATCH", () => handlePATCH(req, ctx));
}
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/webhooks DELETE", () => handleDELETE(req, ctx));
}

// GET /api/v1/webhooks/[id] - one subscription + its delivery history
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/webhooks GET", async () => {
    const u = await getRequestUser(req);
    if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { id } = await ctx.params;
    const sub = getWebhookSubscription(id);
    if (!sub || sub.workspaceId !== u.workspaceId) {
      return NextResponse.json({ error: "Webhook 不存在" }, { status: 404 });
    }
    return NextResponse.json({ webhook: sub, deliveries: listDeliveryRecords(id, 30) });
  });
}
