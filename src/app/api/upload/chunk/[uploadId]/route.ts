import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getSession, markChunkReceived, deleteSession } from "@/lib/upload/store";
import { uploadPart, abortMultipartUpload } from "@/lib/storage/s3";
import { isStorageEnabled } from "@/lib/storage";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ uploadId: string }> };

// POST /api/upload/chunk/[uploadId]
// Upload a single chunk. Body: multipart/form-data with "chunk" (File) + "index" (number).
export async function POST(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { uploadId } = await params;

  const session = getSession(uploadId);
  if (!session) return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
  if (session.userId !== u.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 });
  }

  const chunk = form.get("chunk");
  const indexStr = form.get("index");
  if (!(chunk instanceof File) || indexStr === null) {
    return NextResponse.json({ error: "缺少 chunk 或 index" }, { status: 400 });
  }

  const index = parseInt(indexStr.toString(), 10);
  if (isNaN(index) || index < 0 || index >= session.totalChunks) {
    return NextResponse.json({ error: `无效的分片索引: ${index}` }, { status: 400 });
  }

  // Already received? Skip (idempotent for resume)
  if (session.receivedChunks.has(index)) {
    return NextResponse.json({ index, received: true, skipped: true });
  }

  const data = Buffer.from(await chunk.arrayBuffer());

  if (isStorageEnabled() && session.s3UploadId && session.s3Key) {
    // S3 mode: upload part
    try {
      const etag = await uploadPart(session.s3Key, session.s3UploadId, index + 1, data);
      markChunkReceived(uploadId, index, etag);
    } catch (e) {
      return NextResponse.json(
        { error: `S3 分片上传失败: ${e instanceof Error ? e.message : e}` },
        { status: 500 }
      );
    }
  } else if (session.tempDir) {
    // Local mode: save chunk file
    await fs.writeFile(path.join(session.tempDir, `${index}`), data);
    markChunkReceived(uploadId, index);
  } else {
    return NextResponse.json({ error: "上传会话状态异常" }, { status: 500 });
  }

  return NextResponse.json({
    index,
    received: true,
    progress: session.receivedChunks.size,
    total: session.totalChunks,
  });
}

// DELETE /api/upload/chunk/[uploadId]
// Abort an upload session and clean up.
export async function DELETE(_req: Request, { params }: Params) {
  const u = await getRequestUser(_req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { uploadId } = await params;

  const session = getSession(uploadId);
  if (!session) return NextResponse.json({ error: "上传会话不存在" }, { status: 404 });
  if (session.userId !== u.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  // Clean up
  if (isStorageEnabled() && session.s3UploadId && session.s3Key) {
    try {
      await abortMultipartUpload(session.s3Key, session.s3UploadId);
    } catch {
      // Best-effort cleanup
    }
  } else if (session.tempDir) {
    await fs.rm(session.tempDir, { recursive: true, force: true }).catch(() => {});
  }

  deleteSession(uploadId);
  return NextResponse.json({ aborted: true });
}
