import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getKb, addDocument, docTypeFromName, isTextLike } from "@/lib/kb/store";
import type { KbDocument } from "@/lib/kb/types";
import { notify } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB per file
const MAX_TEXT = 2 * 1024 * 1024; // 2 MB of text indexed per file

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

// POST /api/knowledge-base/[id]/upload
// multipart/form-data "files" (one or more) OR JSON { url, name } for a web link.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });

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
    const doc = addDocument({
      kbId: id,
      name: body.name?.trim() || body.url.trim(),
      size: -1,
      url: body.url.trim(),
    });
    notify("kbReady", `知识库「${kb.name}」新增文档`, `${doc.name} 已添加并处理完成。`, "/knowledge-base");
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
    if (file.size > MAX_SIZE) {
      errors.push(`${file.name} 超过 25MB 限制`);
      continue;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(await file.arrayBuffer());
    } catch {
      errors.push(`${file.name} 读取失败`);
      continue;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_");
    try {
      await fs.writeFile(path.join(kbDir, `${Date.now()}-${safeName}`), buf);
    } catch {
      errors.push(`${file.name} 保存失败`);
      continue;
    }
    // extract text for indexing (text-like formats only; PDF/Word need a real loader)
    const dtype = docTypeFromName(file.name);
    const content = isTextLike(dtype) ? buf.toString("utf-8").slice(0, MAX_TEXT) : undefined;
    const doc = addDocument({ kbId: id, name: file.name, size: file.size, content });
    created.push(doc);
  }

  if (created.length > 0) {
    notify(
      "kbReady",
      `知识库「${kb.name}」处理完成`,
      `${created.length} 篇文档已成功处理${errors.length > 0 ? `（${errors.length} 篇失败）` : ""}，可以开始问答了。`,
      "/knowledge-base"
    );
  }
  return NextResponse.json({ docs: created, errors }, { status: 201 });
}
