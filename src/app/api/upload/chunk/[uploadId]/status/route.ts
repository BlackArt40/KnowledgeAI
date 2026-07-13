import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getSession } from "@/lib/upload/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ uploadId: string }> };

// GET /api/upload/chunk/[uploadId]/status
// Returns which chunks have been received (for resume support).
export async function GET(_req: Request, { params }: Params) {
  const u = await getRequestUser(_req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { uploadId } = await params;

  const session = getSession(uploadId);
  if (!session) return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
  if (session.userId !== u.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  return NextResponse.json({
    uploadId,
    filename: session.filename,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks,
    receivedChunks: Array.from(session.receivedChunks).sort((a, b) => a - b),
    complete: session.receivedChunks.size === session.totalChunks,
  });
}
