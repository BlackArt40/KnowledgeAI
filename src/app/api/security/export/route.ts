import { NextResponse } from "next/server";
import { exportData } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const data = exportData(u.id);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="knowledgeai-data-${Date.now()}.json"`,
    },
  });
}
