import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getKb } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { validateFile } from "@/lib/storage";
import { isStorageEnabled } from "@/lib/storage";
import { createMultipartUpload } from "@/lib/storage/s3";
import { createSession, getChunkSize, getActiveUploadIds } from "@/lib/upload/store";
import { cleanupOrphanedChunks } from "@/lib/storage/cleanup";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// POST /api/upload/chunk/init
// Body: { kbId, filename, fileSize }
// Initializes a chunked upload session.
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { kbId?: string; filename?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const { kbId, filename, fileSize } = body;
  if (!kbId || !filename || !fileSize) {
    return NextResponse.json({ error: "缺少必要参数: kbId, filename, fileSize" }, { status: 400 });
  }

  const kb = getKb(kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  // Validate file type (whitelist) + chunked size limit (larger than direct upload)
  const validation = validateFile(filename, 0); // size=0 skips size check, validates type only
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const chunkedMax = parseInt(process.env.MAX_CHUNKED_UPLOAD_MB || "500", 10) * 1024 * 1024;
  if (fileSize > chunkedMax) {
    return NextResponse.json(
      { error: `文件过大: ${(fileSize / 1024 / 1024).toFixed(1)}MB。分片上传上限: ${chunkedMax / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  // Lazy cleanup: remove orphaned chunk dirs (fire-and-forget)
  void cleanupOrphanedChunks(getActiveUploadIds());

  const chunkSize = getChunkSize();
  const totalChunks = Math.ceil(fileSize / chunkSize);

  let s3UploadId: string | null = null;
  let s3Key: string | null = null;
  let tempDir: string | null = null;

  if (isStorageEnabled()) {
    // S3 mode: initiate multipart upload
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    s3Key = `${randomUUID()}${ext}`;
    try {
      s3UploadId = await createMultipartUpload(s3Key);
    } catch (e) {
      return NextResponse.json(
        { error: `S3 分片上传初始化失败: ${e instanceof Error ? e.message : e}` },
        { status: 500 }
      );
    }
  } else {
    // Local mode: create temp directory for chunks
    tempDir = path.join(process.cwd(), ".uploads", ".chunks", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });
  }

  const session = createSession({
    kbId,
    userId: u.id,
    filename,
    fileSize,
    fileType: filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "",
    chunkSize,
    totalChunks,
    s3UploadId,
    s3Key,
    tempDir,
  });

  return NextResponse.json({
    uploadId: session.uploadId,
    chunkSize,
    totalChunks,
  });
}
