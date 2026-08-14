import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  listDeliveryRecords,
  isValidWebhookUrl,
  auditWebhook,
} from "@/lib/webhooks/store";
import type { WebhookEvent } from "@/lib/webhooks/types";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/types";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// Versioned public API (P7-1): webhook subscription management.
// Authenticated via JWT session or API key. API-key callers MUST carry the
// `webhooks:write` scope (JWT sessions pass - they already hold full
// privileges). NOTE: a subscription URL is a credential-ish endpoint -
// creating/updating it is audited (webhook.create / webhook.delete).

async function handleGET(req: Request) {
  const scope = await requireApiKeyScope(req, "webhooks:write");
  if (scope.error) return scope.error;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const subs = listWebhookSubscriptions(u.workspaceId);
  return NextResponse.json({
    webhooks: subs,
    // deliveries are tenant-scoped - never list across workspaces
    deliveries: listDeliveryRecords(u.workspaceId, undefined, 30),
  });
}

async function handlePOST(req: Request) {
  const scope = await requireApiKeyScope(req, "webhooks:write");
  if (scope.error) return scope.error;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { name?: string; url?: string; secret?: string; events?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.url || !isValidWebhookUrl(body.url)) {
    return NextResponse.json({ error: "Webhook 地址必须是 http/https URL" }, { status: 400 });
  }
  const events = (body.events ?? []) as WebhookEvent[];
  if (events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
    return NextResponse.json(
      { error: `events 必须是非空数组，可选值: ${WEBHOOK_EVENTS.join(", ")}` },
      { status: 400 }
    );
  }

  const sub = createWebhookSubscription({
    userId: u.id,
    workspaceId: u.workspaceId,
    name: body.name ?? "未命名",
    url: body.url,
    secret: body.secret,
    events,
  });
  if (!sub) return NextResponse.json({ error: "创建失败" }, { status: 400 });

  auditWebhook(u.id, u.name, "webhook.create", sub.id, `events=${sub.events.join(",")} url=${sub.url}`);
  return NextResponse.json({ webhook: sub }, { status: 201 });
}

export async function GET(req: Request) {
  return withApiTrace(req, "api /api/v1/webhooks GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/webhooks POST", () => handlePOST(req));
}
