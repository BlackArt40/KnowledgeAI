import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getKb, addDocument, deleteDocument } from "@/lib/kb/store";
import type { KbDocument } from "@/lib/kb/types";
import { canEditKb } from "@/lib/team/store";
import { getConfig } from "@/lib/admin/store";
import { notify } from "@/lib/notifications/store";
import { getRequestUser } from "@/lib/auth/guard";
import { fetchUrlContent } from "@/lib/rag/fetcher";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

// POST /api/knowledge-base/[id]/upload
// multipart/form-data "files" (one or more) OR JSON { url, name } for a web link.
async function handleUpload(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });

  const contentType = req.headers.get("content-type") ?? "";

  // ---- web link via JSON ----
  if (contentType.includes("application/json")) {
    let body: { url?: string; name?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
    }
    if (!body.url?.trim()) {
      return NextResponse.json({ error: "URL 不能为空" }, { status: 400 });
    }
    const link = body.url.trim();
    // Fetch the page content so the link can be chunked + indexed like a file.
    const fetched = await fetchUrlContent(link);
    const doc = addDocument({
      kbId: id,
      name: body.name?.trim() || fetched?.title || link,
      size: fetched?.text.length ?? -1,
      url: link,
      content: fetched?.text,
    });
    notify(
      u.id,
      "kbReady",
      `知识库「${kb.name}」已添加网页`,
      fetched
        ? `${doc.name} 已添加，正在后台解析与索引。`
        : `${link} 已添加，但未能抓取页面内容（可能需要稍后重试）。`,
      "/knowledge-base"
    );
    return NextResponse.json({ docs: [doc] }, { status: 201 });
  }

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "仅支持 multipart/form-data 或 JSON" }, { status: 415 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "未检测到文件" }, { status: 400 });
  }

  const kbDir = path.join(UPLOAD_DIR, id);
  await ensureDir(kbDir);

  const created: KbDocument[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const maxBytes = getConfig().maxUploadMb * 1024 * 1024;
    if (file.size > maxBytes) {
      errors.push(`${file.name} 超过 ${getConfig().maxUploadMb}MB 限制`);
      continue;
    }
    // M-3: read the file as a stream instead of one big arrayBuffer() so a
    // large upload never balloons the request thread's memory (OOM guard).
    const chunks: Buffer[] = [];
    try {
      const reader = file.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
    } catch {
      errors.push(`${file.name} 读取失败`);
      continue;
    }
    const buf = Buffer.concat(chunks);
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_");
    // M-3: create the doc FIRST (skip the auto-enqueue) so the background
    // doc-process worker can locate the file by docId, then write the file,
    // then enqueue - parsing now happens in the queue, not the request thread.
    const doc = addDocument({ kbId: id, name: file.name, size: file.size, skipEnqueue: true });
    try {
      await fs.writeFile(path.join(kbDir, `${doc.id}-${safeName}`), buf);
    } catch {
      errors.push(`${file.name} 保存失败`);
      await deleteDocument(doc.id).catch(() => {});
      continue;
    }
    // Enqueue only after the file is on disk (no parse race).
    void import("@/lib/queue").then(({ enqueue }) => enqueue("doc-process", { docId: doc.id }));
    created.push(doc);
  }

  if (created.length > 0) {
    // L-3: M-3 moved parsing into the background queue, so the upload route
    // only confirms the files were accepted + enqueued - NOT that they are
    // ready to query. The kb.ready webhook + the doc status SSE still fire
    // when indexing actually completes (or fails).
    notify(
      u.id,
      "kbReady",
      `知识库「${kb.name}」已接收上传`,
      `${created.length} 篇文档已上传，正在后台解析与索引${errors.length > 0 ? `（${errors.length} 篇失败）` : ""}，完成后即可问答。`,
      "/knowledge-base"
    );
  }
  return NextResponse.json({ docs: created, errors }, { status: 201 });
}

// P6-1: request tracing + SLI metrics for the upload route.
export async function POST(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/upload", () => handleUpload(req, ctx));
}
