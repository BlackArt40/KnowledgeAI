import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getWebhookSubscription, auditWebhook } from "@/lib/webhooks/store";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// POST /api/v1/webhooks/[id]/test - enqueue a `ping` test delivery so the
// subscriber can verify the endpoint + HMAC signature end-to-end.
async function handlePOST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const sub = getWebhookSubscription(id);
  if (!sub || sub.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "Webhook 不存在" }, { status: 404 });
  }

  const { enqueue } = await import("@/lib/queue");
  await enqueue("webhook-deliver", {
    subscriptionId: sub.id,
    payload: {
      event: "ping",
      ts: Date.now(),
      data: { message: `来自 ${u.name} 的测试事件` },
    },
  });
  auditWebhook(u.id, u.name, "webhook.test", sub.id, "");
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/webhooks test", () => handlePOST(req, ctx));
}
