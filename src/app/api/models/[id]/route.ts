import { NextResponse } from "next/server";
import { updateModel, deleteModel, sanitize } from "@/lib/models/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// PATCH /api/models/[id] - update THIS USER's model config
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const result = updateModel(u.id, id, body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ model: sanitize(result) });
}

// DELETE /api/models/[id] - remove THIS USER's model config
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const ok = deleteModel(u.id, id);
  if (!ok) return NextResponse.json({ error: "模型配置不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
