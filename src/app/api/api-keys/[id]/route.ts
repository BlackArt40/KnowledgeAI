import { NextResponse } from "next/server";
import { toggleKey, deleteKey } from "@/lib/apikeys/store";
import type { KeyStatus } from "@/lib/apikeys/types";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// PATCH /api/api-keys/[id] - toggle status (owner only)
export async function PATCH(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  let body: { status?: KeyStatus };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.status) return NextResponse.json({ error: "status 必填" }, { status: 400 });
  const key = toggleKey(id, body.status, u.id);
  if (!key) return NextResponse.json({ error: "密钥不存在" }, { status: 404 });
  return NextResponse.json({ key });
}

// DELETE /api/api-keys/[id] - delete key (owner only)
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const ok = deleteKey(id, u.id);
  if (!ok) return NextResponse.json({ error: "密钥不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
