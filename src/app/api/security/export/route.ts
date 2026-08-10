import { NextResponse } from "next/server";
import { exportData } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const data = exportData(u.id);
  // P3-4: GDPR-style data export is a sensitive operation - audit it.
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "privacy.export",
    target: "个人数据导出",
    detail: "GDPR 数据导出",
  });
  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="knowledgeai-data-${Date.now()}.json"`,
    },
  });
}
