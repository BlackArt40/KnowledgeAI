// P7-2: Confluence sync - import a space's pages into a knowledge base.
// POST /api/v1/integrations/sync/confluence  { kbId, spaceKey }
// Auth: login session or API key with kb:write. Requires CONFLUENCE_BASE_URL
// + CONFLUENCE_EMAIL + CONFLUENCE_TOKEN env.
import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { syncConfluenceToKb } from "@/lib/integrations/sync";
import { isConfluenceConfigured } from "@/lib/integrations/sync/confluence";
import { withApiTrace } from "@/lib/obs/trace";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await requireApiKeyScope(req, "kb:write");
  if (scope.error) return scope.error;

  let body: { kbId?: string; spaceKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.spaceKey?.trim()) {
    return NextResponse.json({ error: "spaceKey 不能为空" }, { status: 400 });
  }
  if (!isConfluenceConfigured()) {
    return NextResponse.json(
      { error: "未配置 Confluence（CONFLUENCE_BASE_URL / EMAIL / TOKEN）" },
      { status: 400 }
    );
  }

  const kb = getKb(body.kbId ?? "");
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  try {
    const result = await syncConfluenceToKb(u, kb, { spaceKey: body.spaceKey });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/integrations/sync/confluence POST", () => handlePOST(req));
}
