import { NextResponse } from "next/server";
import { getSecurity } from "@/lib/security/store";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(getSecurity());
}
