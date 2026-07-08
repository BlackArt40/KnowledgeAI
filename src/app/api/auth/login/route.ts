import { NextResponse } from "next/server";
import { verifyCredentials, sanitize } from "@/lib/auth/store";
import { createToken } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/store";
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

  // Security alert: notify on login (especially useful for detecting unauthorized access)
  const ua = req.headers.get("user-agent") ?? "未知设备";
  notify(
    "securityAlert",
    "检测到新登录",
    `${user.name} 在 ${ua.split(") ")[0].split("(").pop() || ua} 上登录了账号。`,
    "/settings"
  );

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
