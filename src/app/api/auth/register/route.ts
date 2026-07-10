import { NextResponse } from "next/server";
import { createUser, sanitize } from "@/lib/auth/store";
import { getConfig } from "@/lib/admin/store";
import { createToken } from "@/lib/auth/session";
export const dynamic = "force-dynamic";

// POST /api/auth/register { name, email, password }
export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  // Check if registration is allowed (admin config).
  if (!getConfig().allowSignup) {
    return NextResponse.json({ error: "管理员已关闭新用户注册" }, { status: 403 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "昵称、邮箱、密码必填" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  const result = createUser(name, email, password, "editor");
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const token = await createToken({
    id: result.id,
    email: result.email,
    name: result.name,
    role: result.role,
  });

  const res = NextResponse.json({ user: sanitize(result), token }, { status: 201 });
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}
