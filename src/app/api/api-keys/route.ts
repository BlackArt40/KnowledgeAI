import { NextResponse } from "next/server";
import { listKeys, createKey } from "@/lib/apikeys/store";
import { SCOPES } from "@/lib/apikeys/types";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/api-keys - list the CURRENT user's keys only.
// P3-4: secrets are stored encrypted and must never leave the server again -
// list responses return sanitized keys (prefix + mask), the full secret is
// only visible once in the POST /api/api-keys creation response.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const keys = listKeys(u.id).map((k) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { secret, ...rest } = k;
    return rest;
  });
  return NextResponse.json({ keys });
}

// POST /api/api-keys - create a new key for the current user
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { name?: string; scopes?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  // P1-7: only whitelisted scopes may be granted - an arbitrary string was
  // previously stored verbatim, letting a user self-sign any scope (e.g.
  // webhooks:write) and widen their own attack surface.
  const validScopes = new Set<string>(SCOPES.map((s) => s.id));
  const scopes = body.scopes ?? [];
  if (scopes.some((s) => !validScopes.has(s))) {
    return NextResponse.json(
      { error: `非法 scope，可选值: ${Array.from(validScopes).join(", ")}` },
      { status: 400 }
    );
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }
  const key = createKey(name, scopes, u.id);
  return NextResponse.json({ key }, { status: 201 });
}
