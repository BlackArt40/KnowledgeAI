import { NextResponse } from "next/server";
import { listModelsSafe, createModel, getProvider, PROVIDERS } from "@/lib/models/store";
import { getRequestUser } from "@/lib/auth/guard";
import type { ProviderId } from "@/lib/models/types";
export const dynamic = "force-dynamic";

// GET /api/models - list THIS USER's configured models + provider presets
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    models: listModelsSafe(u.id),
    providers: PROVIDERS,
  });
}

// POST /api/models - create a new model config for THIS USER
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: {
    name?: string; provider?: ProviderId; apiKey?: string;
    baseUrl?: string; chatModel?: string; embeddingModel?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const preset = body.provider ? getProvider(body.provider) : undefined;
  const result = createModel(u.id, {
    name: body.name ?? "",
    provider: body.provider ?? "custom",
    apiKey: body.apiKey,
    baseUrl: body.baseUrl ?? preset?.baseUrl ?? "",
    chatModel: body.chatModel ?? "",
    embeddingModel: body.embeddingModel,
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ model: result }, { status: 201 });
}
