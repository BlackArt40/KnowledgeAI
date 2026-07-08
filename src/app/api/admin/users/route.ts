import { NextResponse } from "next/server";
import { listUsers } from "@/lib/admin/store";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ users: listUsers() });
}
