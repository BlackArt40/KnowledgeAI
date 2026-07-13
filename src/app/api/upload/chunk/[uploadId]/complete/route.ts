import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { getSession, deleteSession } from "@/lib/upload/store";
import { isStorageEnabled } from "@/lib/storage";
import { completeMultipartUpload, downloadFromS3 } from "@/lib/storage/s3";
import { getKb, addDocument, docTypeFromName, isTextLike } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { notify } from "@/lib/notifications/store";
import { parseDocument } from "@/lib/rag/parser";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const MAX_TEXT = 2 * 1024 * 1024; // 2 MB of text indexed per file

type Params = { params: Promise<{ uploadId: string }> };

// POST /api/upload/chunk/[uploadId]/complete
// Merges all chunks, processes the document, and adds it to the KB.
export async function POST(_req: Request, { params }: Params) {
  const u = await getRequestUser(_req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { uploadId } = await params;

  const session = getSession(uploadId);
  if (!session) return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
  if (session.userId !== u.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  // Verify all chunks received
  if (session.receivedChunks.size !== session.totalChunks) {
    return NextResponse.json(
      { error: `分片不完整: ${session.receivedChunks.size}/${session.totalChunks}` },
      { status: 400 }
    );
  }

  const kb = getKb(session.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  try {
    // ── Assemble the complete file ──────────────────────────────
    let buf: Buffer;

    if (isStorageEnabled() && session.s3UploadId && session.s3Key) {
      // S3 mode: complete multipart upload, then download for processing
      const parts = Array.from(session.partETags.entries()).map(([partNumber, etag]) => ({
        partNumber,
        etag,
      }));
      await completeMultipartUpload(session.s3Key, session.s3UploadId, parts);
      buf = await downloadFromS3(session.s3Key);
    } else if (session.tempDir) {
      // Local mode: merge chunk files
      const chunks: Buffer[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkBuf = await fs.readFile(path.join(session.tempDir, `${i}`));
        chunks.push(chunkBuf);
      }
      buf = Buffer.concat(chunks);
    } else {
      return NextResponse.json({ error: "上传会话状态异常" }, { status: 500 });
    }

    // ── Parse + index ───────────────────────────────────────────
    const dtype = docTypeFromName(session.filename);
    let content: string | undefined;
    if (isTextLike(dtype)) {
      content = buf.toString("utf-8").slice(0, MAX_TEXT);
    } else {
      const parsed = await parseDocument(buf, session.filename, dtype);
      if (parsed) content = parsed.text.slice(0, MAX_TEXT);
    }

    const doc = addDocument({
      kbId: session.kbId,
      name: session.filename,
      size: session.fileSize,
      content,
    });

    // ── Clean up ────────────────────────────────────────────────
    if (session.tempDir) {
      await fs.rm(session.tempDir, { recursive: true, force: true }).catch(() => {});
    }
    deleteSession(uploadId);

    notify(
      u.id,
      "kbReady",
      `知识库「${kb.name}」处理完成`,
      `${session.filename} 已成功上传并处理，可以开始问答了。`,
      "/knowledge-base"
    );

    return NextResponse.json({ doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: `合并处理失败: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
}
