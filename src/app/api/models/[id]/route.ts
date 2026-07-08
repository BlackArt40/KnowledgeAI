import { NextResponse } from "next/server";
import { getModel, updateModel, deleteModel, sanitize } from "@/lib/models/store";
export const dynamic = "force-dynamic";

// PATCH /api/models/[id] - update a model config
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const result = updateModel(id, body);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ model: sanitize(result) });
}

// DELETE /api/models/[id] - remove a model config
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = deleteModel(id);
  if (!ok) return NextResponse.json({ error: "模型配置不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
