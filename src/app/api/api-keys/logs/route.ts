import { NextResponse } from "next/server";
import { listLogs } from "@/lib/apikeys/store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const keyId = new URL(req.url).searchParams.get("keyId") ?? undefined;
  return NextResponse.json({ logs: listLogs(keyId) });
}
