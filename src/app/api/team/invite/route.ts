import { NextResponse } from "next/server";
import { inviteMember } from "@/lib/team/store";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// POST /api/team/invite  { name?, email, role }
export async function POST(req: Request) {
  let body: { name?: string; email?: string; role?: Role };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.email?.trim()) {
    return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });
  }
  const member = inviteMember({
    name: body.name ?? "",
    email: body.email.trim(),
    role: body.role ?? "viewer",
  });
  return NextResponse.json({ member }, { status: 201 });
}
