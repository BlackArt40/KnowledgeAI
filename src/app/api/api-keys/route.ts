import { NextResponse } from "next/server";
import { listKeys, createKey } from "@/lib/apikeys/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/api-keys - list the CURRENT user's keys only
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ keys: listKeys(u.id) });
}

// POST /api/api-keys - create a new key for the current user
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { name?: string; scopes?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const key = createKey(body.name ?? "未命名密钥", body.scopes ?? [], u.id);
  return NextResponse.json({ key }, { status: 201 });
}
