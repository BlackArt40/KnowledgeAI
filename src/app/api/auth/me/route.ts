import { NextResponse } from "next/server";
import { getUserById, sanitize } from "@/lib/auth/store";
import { verifyToken } from "@/lib/auth/session";
export const dynamic = "force-dynamic";

// GET /api/auth/me - get current user from cookie or Authorization header
export async function GET(req: Request) {
  // Try cookie first, then Authorization header
  const cookieToken = req.headers.get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kai-token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = getUserById(payload.id);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({ user: sanitize(user) });
}
