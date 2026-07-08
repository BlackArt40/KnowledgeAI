import { NextResponse } from "next/server";
import { listKbs } from "@/lib/admin/store";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ kbs: listKbs() });
}
