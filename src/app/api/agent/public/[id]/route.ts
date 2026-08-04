import { NextResponse } from "next/server";
import { getTask, recordShareView, verifyPassword } from "@/lib/agent/store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// GET /api/agent/public/[id] - public read-only view of a finished report.
// Criterion #2: enforces share link permissions (expiry / password / view limit).
//   - No shareConfig configured  -> public (backward compatible with existing links)
//   - shareConfig.enabled === false -> 403 (sharing disabled)
//   - shareConfig.enabled === true  -> check expiry (410) / password (401) / views (403)
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  if (task.status !== "done") return NextResponse.json({ error: "报告尚未完成" }, { status: 400 });

  const cfg = task.shareConfig;
  if (cfg) {
    if (cfg.enabled === false) {
      return NextResponse.json({ error: "分享链接已关闭", code: "disabled" }, { status: 403 });
    }
    if (cfg.enabled === true) {
      if (cfg.expiresAt && Date.now() > cfg.expiresAt) {
        return NextResponse.json({ error: "分享链接已过期", code: "expired" }, { status: 410 });
      }
      if (cfg.passwordHash) {
        const pwd =
          req.headers.get("x-share-password") ?? new URL(req.url).searchParams.get("password") ?? "";
        if (!verifyPassword(pwd, cfg.passwordHash)) {
          return NextResponse.json({ error: "需要访问密码", code: "needPassword" }, { status: 401 });
        }
      }
      if (cfg.maxViews !== undefined && cfg.views >= cfg.maxViews) {
        return NextResponse.json({ error: "访问次数已用尽", code: "exhausted" }, { status: 403 });
      }
      recordShareView(id);
    }
  }

  return NextResponse.json({
    topic: task.topic,
    report: task.report,
    citations: task.citations,
    comments: task.comments ?? [],
    outputFormat: task.outputFormat,
    durationMs: task.durationMs,
    createdAt: task.createdAt,
    protected: !!(cfg && cfg.enabled),
    views: cfg?.views ?? 0,
  });
}
