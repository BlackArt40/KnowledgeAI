import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { getUserById } from "@/lib/auth/store";
import { requestUserFromUser } from "@/lib/auth/guard";
import {
  getBotByToken,
  recordBotCall,
  parsePlatformMessage,
  buildPlatformReply,
  buildEmptyReply,
  BOT_PLATFORMS,
  type BotPlatform,
} from "@/lib/integrations/bots";
import { askOnce } from "@/lib/chat/ask-once";
import { integrationRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { withApiTrace, type ApiTraceHandle } from "@/lib/obs/trace";
import { log } from "@/lib/obs/log";

export const dynamic = "force-dynamic";

// POST /api/v1/integrations/bot/m/[token] - platform webhook callback (P7-2).
//
// The token IS the credential (SHA-256-hashed server-side; delivered once at
// creation). In the proxy SKIP_PATHS: enforcement happens here via the
// integration tier (integration:<id>), so one bot can't starve its owner.
//
// Supported platforms (the binding's platform decides the parse):
//   slack    - url_verification challenge / event_callback.text / text
//   feishu   - url_verification challenge / event.message.content JSON text
//   dingtalk - text.content
//   test     - raw { text } -> returns { answer, citations } for tooling
// Replies use the platform's message format (echoed for verification).
async function handlePOST(req: Request, ctx: { params: Promise<{ token: string }> }, trace?: ApiTraceHandle) {
  const { token } = await ctx.params;
  const binding = await getBotByToken(token);
  if (!binding || !binding.active) {
    return NextResponse.json({ error: "无效的机器人令牌" }, { status: 401 });
  }

  // Independent rate limit per integration (P7-2 acceptance: integrations
  // have their own auth AND rate limiting).
  const rl = await integrationRateLimit(binding.id);
  if (!rl.allowed) return rateLimitResponse(rl, "integration");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  // Platform override header (x-kai-platform) lets a single endpoint serve
  // multiple platform formats - used by tests and shared-endpoint setups.
  const override = req.headers.get("x-kai-platform");
  const platform = override && BOT_PLATFORMS.includes(override as never)
    ? (override as BotPlatform)
    : binding.platform;

  const { text, challenge } = parsePlatformMessage(platform, body);
  if (challenge) {
    // Slack / 飞书 URL verification - echo the challenge verbatim.
    return NextResponse.json({ challenge });
  }

  recordBotCall(binding.id);

  if (!text) {
    const hint = `我是 KnowledgeAI 机器人，绑定知识库「${binding.kbName ?? binding.kbId}」，直接向我提问即可。`;
    return NextResponse.json(buildEmptyReply(binding.platform, hint));
  }

  // Answer as the binding owner (their permissions + model context). The
  // workspace is the BINDING's workspace (captured at creation), not the
  // owner's default - bot usage + conversations must meter the right tenant.
  const owner = getUserById(binding.userId);
  if (!owner) return NextResponse.json({ error: "机器人属主不存在" }, { status: 500 });
  const user = {
    ...requestUserFromUser(owner),
    workspaceId: binding.workspaceId,
  };

  const kb = getKb(binding.kbId);
  if (!kb) {
    return NextResponse.json(buildPlatformReply(binding.platform, "", "绑定的知识库已被删除，请联系管理员。"));
  }

  const started = Date.now();
  const result = await askOnce(user, binding.kbId, text, { trace });
  if (result.error) {
    log.warn({ err: result.error }, "[bot] ask failed");
    return NextResponse.json(
      buildPlatformReply(binding.platform, "", `抱歉，问答失败：${result.error}`)
    );
  }
  log.info(`[bot] ${binding.platform} ${binding.name} answered in ${Date.now() - started}ms`);

  if (platform === "test") {
    // Raw JSON for tooling / acceptance tests.
    return NextResponse.json({ answer: result.answer, citations: result.citations });
  }
  return NextResponse.json(buildPlatformReply(platform, result.answer, "抱歉，暂时没有找到相关答案。"));
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return withApiTrace(req, "api /api/v1/integrations/bot/m", (trace) => handlePOST(req, ctx, trace));
}
