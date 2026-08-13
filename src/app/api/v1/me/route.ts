import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/v1/me - identity + workspace of the authenticated caller
// (JWT session or API key). Useful for SDKs to verify credentials.
async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, workspaceId: u.workspaceId },
  });
}

export async function GET(req: Request) {
  return withApiTrace(req, "api /api/v1/me", () => handleGET(req));
}
