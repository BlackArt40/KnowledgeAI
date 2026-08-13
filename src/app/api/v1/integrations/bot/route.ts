import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import {
  createBotBinding,
  listBotBindings,
  auditBot,
  BOT_PLATFORMS,
  type BotPlatform,
} from "@/lib/integrations/bots";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// Versioned public API (P7-2): chat-bot integrations.
//   GET  /api/v1/integrations/bot          - list bindings (workspace-scoped)
//   POST /api/v1/integrations/bot          - create a binding {name, platform, kbId}
// The callback endpoint lives at /api/v1/integrations/bot/m/<token> (the
// token is the credential; created once, stored hashed).

async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const bots = listBotBindings(u.workspaceId).map(({ tokenHash: _t, ...rest }) => rest);
  return NextResponse.json({ bots });
}

async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { name?: string; platform?: string; kbId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const platform = body.platform as BotPlatform | undefined;
  if (!platform || !BOT_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `platform 必须为 ${BOT_PLATFORMS.join(" / ")} 之一` },
      { status: 400 }
    );
  }
  if (!body.kbId) return NextResponse.json({ error: "kbId 必填" }, { status: 400 });

  const kb = getKb(body.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId)) {
    return NextResponse.json({ error: "无权使用该知识库" }, { status: 403 });
  }

  const created = await createBotBinding({
    user: u,
    name: body.name ?? `${platform} 机器人`,
    platform,
    kbId: kb.id,
    kbName: kb.name,
  });
  if (!created) return NextResponse.json({ error: "创建失败" }, { status: 400 });

  auditBot(u.id, u.name, "bot.create", created.binding.id, `platform=${platform} kb=${kb.id}`);
  return NextResponse.json({ bot: { ...created.binding, token: created.token } }, { status: 201 });
}

export async function GET(req: Request) {
  return withApiTrace(req, "api /api/v1/integrations/bot GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/integrations/bot POST", () => handlePOST(req));
}
