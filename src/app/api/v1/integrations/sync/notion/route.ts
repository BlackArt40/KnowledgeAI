// P7-2: Notion sync - import a database's pages into a knowledge base.
// POST /api/v1/integrations/sync/notion  { kbId, databaseId, token? }
// Auth: login session or API key with kb:write. Token resolution: body
// token wins, else NOTION_TOKEN env. 400 when neither is configured.
import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { syncNotionToKb } from "@/lib/integrations/sync";
import { isNotionConfigured } from "@/lib/integrations/sync/notion";
import { withApiTrace } from "@/lib/obs/trace";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await requireApiKeyScope(req, "kb:write");
  if (scope.error) return scope.error;

  let body: { kbId?: string; databaseId?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.databaseId?.trim()) {
    return NextResponse.json({ error: "databaseId 不能为空" }, { status: 400 });
  }
  if (!isNotionConfigured() && !body.token?.trim()) {
    return NextResponse.json({ error: "未配置 Notion Token（NOTION_TOKEN 或请求体 token）" }, { status: 400 });
  }

  const kb = getKb(body.kbId ?? "");
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId })) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  try {
    const result = await syncNotionToKb(u, kb, { databaseId: body.databaseId, token: body.token });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/integrations/sync/notion POST", () => handlePOST(req));
}
