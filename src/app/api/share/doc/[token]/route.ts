import { checkDocShare } from "@/lib/kb/doc-share";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

// GET /api/share/doc/[token] - PUBLIC access to a shared document (P4-2).
// No authentication: the share token itself is the credential. Error codes
// follow the Agent share convention: 410 expired / 401 need password /
// 403 view limit exhausted / 404 unknown or revoked.
// Only a text preview (first 3000 chars) is exposed - full content stays in
// the knowledge base.
export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const password = new URL(req.url).searchParams.get("password") ?? undefined;
  const result = checkDocShare(token, password);

  if (!result.ok) {
    return Response.json({ error: "分享链接不可用", code: result.code }, { status: result.status });
  }

  const { share, doc } = result;
  return Response.json({
    name: doc.name,
    type: doc.type,
    size: doc.size,
    uploadedAt: doc.uploadedAt,
    content: (doc.content ?? "").slice(0, 3000),
    expiresAt: share.expiresAt ?? null,
    views: share.views,
    maxViews: share.maxViews ?? null,
    createdBy: share.createdBy,
  });
}
