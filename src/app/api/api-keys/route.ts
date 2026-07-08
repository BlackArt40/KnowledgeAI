import { NextResponse } from "next/server";
import { listKeys, createKey } from "@/lib/apikeys/store";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ keys: listKeys() });
}

export async function POST(req: Request) {
  let body: { name?: string; scopes?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const key = createKey(body.name ?? "未命名密钥", body.scopes ?? []);
  return NextResponse.json({ key }, { status: 201 });
}
