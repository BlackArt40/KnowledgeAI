import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getRequestUser } from "@/lib/auth/guard";
import { isStorageEnabled, readFile } from "@/lib/storage";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

// L-4: serve locally-stored files (the /api/files/<key> URL returned by
// saveFile() in local mode used to dangle - no route existed). Security:
//   - key is strictly validated (no path separators / traversal)
//   - only in LOCAL storage mode (S3 uses presigned URLs, not this route)
//   - requires an authenticated user (logged-in session or API key)
//   - served as an attachment so HTML/SVG payloads can never execute in a
//     browser context
const KEY_RE = /^[a-zA-Z0-9._-]+$/;

// Content-Type by extension (attachment download regardless).
function contentTypeFor(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".srt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}

// GET /api/files/[key] - download a stored file (local storage mode only).
async function handleGET(req: Request, { params }: Params) {
  const { key } = await params;
  // L-4: never allow traversal - keys are flat UUID.ext names.
  if (!KEY_RE.test(key) || key.includes("..")) {
    return NextResponse.json({ error: "非法文件 key" }, { status: 400 });
  }
  // S3 mode serves downloads via presigned URLs - this route is local-only.
  if (isStorageEnabled()) {
    return NextResponse.json({ error: "请使用预签名下载链接" }, { status: 404 });
  }
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const data = await readFile(key);
    if (!data || data.byteLength === 0) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(key),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "Content-Length": String(data.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/files/[key] GET", () => handleGET(req, ctx));
}
