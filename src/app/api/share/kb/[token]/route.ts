import {
  checkKbShare,
  KB_SHARE_PREVIEW_CHARS,
  KB_SHARE_SNIPPET_CHARS,
} from "@/lib/kb/kb-share";
import { publicShareRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientInfoFromRequest } from "@/lib/security/ua";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

// GET /api/share/kb/[token] - PUBLIC read-only access to a shared knowledge
// base（共享与分发）. No authentication: the token itself is the credential.
// Error codes match the doc/report share convention: 410 expired / 401 need
// password / 403 view limit exhausted / 404 unknown or revoked.
//
// `?doc=<docId>` returns one document's text preview (first 3000 chars). The
// list request counts as a view; opening previews does not, so a view budget
// is not burned by browsing.
export async function GET(req: Request, { params }: Params) {
  const rl = await publicShareRateLimit(clientInfoFromRequest(req).ip);
  if (!rl.allowed) return rateLimitResponse(rl, "share");
  const { token } = await params;
  const url = new URL(req.url);
  const password =
    req.headers.get("x-share-password") ?? url.searchParams.get("password") ?? undefined;
  const docId = url.searchParams.get("doc") ?? undefined;

  const result = checkKbShare(token, password, { countView: !docId });
  if (!result.ok) {
    return Response.json({ error: "分享链接不可用", code: result.code }, { status: result.status });
  }

  const { share, kb, docs } = result;
  const list = docs.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    size: d.size,
    status: d.status,
    chunks: d.chunks,
    uploadedAt: d.uploadedAt,
    snippet: (d.content ?? "").replace(/\s+/g, " ").trim().slice(0, KB_SHARE_SNIPPET_CHARS),
  }));

  let doc: Record<string, unknown> | undefined;
  if (docId) {
    // Only documents already visible in the list can be previewed - a
    // doc-level "private" override therefore stays hidden (404, no oracle).
    const target = docs.find((d) => d.id === docId);
    if (!target) {
      return Response.json({ error: "文档不存在", code: "notFound" }, { status: 404 });
    }
    doc = {
      id: target.id,
      name: target.name,
      type: target.type,
      size: target.size,
      uploadedAt: target.uploadedAt,
      chunks: target.chunks,
      content: (target.content ?? "").slice(0, KB_SHARE_PREVIEW_CHARS),
    };
  }

  return Response.json({
    kb: {
      id: kb.id,
      name: kb.name,
      desc: kb.desc,
      color: kb.color,
      initial: kb.initial,
    },
    docs: list,
    doc,
    expiresAt: share.expiresAt ?? null,
    views: share.views,
    maxViews: share.maxViews ?? null,
  });
}
