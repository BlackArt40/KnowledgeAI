import { NextResponse } from "next/server";
import { verifyCredentials, sanitize } from "@/lib/auth/store";
import { createToken } from "@/lib/auth/session";
export const dynamic = "force-dynamic";

// POST /api/auth/login { email, password }
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const email = body.email?.trim();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码必填" }, { status: 400 });
  }

  const user = verifyCredentials(email, password);
  if (!user) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  const token = await createToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  const res = NextResponse.json({ user: sanitize(user), token });
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}
