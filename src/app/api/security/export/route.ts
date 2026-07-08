import { NextResponse } from "next/server";
import { exportData } from "@/lib/security/store";
export const dynamic = "force-dynamic";
export async function GET() {
  const data = exportData();
  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="knowledgeai-data-${Date.now()}.json"`,
    },
  });
}
