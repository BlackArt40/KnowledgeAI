import { NextResponse } from "next/server";
import { listTasks } from "@/lib/agent/store";
export const dynamic = "force-dynamic";

// GET /api/agent/tasks  (?kbId= optional filter)
export async function GET(req: Request) {
  const kbId = new URL(req.url).searchParams.get("kbId");
  const tasks = listTasks().filter((t) => (kbId ? t.kbId === kbId : true));
  return NextResponse.json({ tasks });
}
