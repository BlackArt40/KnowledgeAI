import { NextResponse } from "next/server";
import { toggleKey, deleteKey } from "@/lib/apikeys/store";
import type { KeyStatus } from "@/lib/apikeys/types";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { status?: KeyStatus };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.status) return NextResponse.json({ error: "status 必填" }, { status: 400 });
  const key = toggleKey(id, body.status);
  if (!key) return NextResponse.json({ error: "密钥不存在" }, { status: 404 });
  return NextResponse.json({ key });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const ok = deleteKey(id);
  if (!ok) return NextResponse.json({ error: "密钥不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
