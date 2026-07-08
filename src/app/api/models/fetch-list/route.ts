import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// POST /api/models/fetch-list  { apiKey, baseUrl }
// Calls the provider's GET /models endpoint (OpenAI-compatible) to list
// available models. Returns { models: string[], chat: string[], embedding: string[] }
export async function POST(req: Request) {
  let body: { apiKey?: string; baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const baseUrl = (body.baseUrl ?? "").replace(/\/$/, "");
  const apiKey = body.apiKey ?? "";

  if (!baseUrl) {
    return NextResponse.json({ error: "Base URL 不能为空" }, { status: 400 });
  }

  const url = `${baseUrl}/models`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, latency },
        { status: 200 }
      );
    }

    const data = await res.json();

    // OpenAI-compatible format: { data: [{ id: "model-name", ... }] }
    // Some providers return { models: [...] } or a plain array
    let rawModels: { id?: string; model?: string }[] = [];
    if (Array.isArray(data?.data)) {
      rawModels = data.data;
    } else if (Array.isArray(data?.models)) {
      rawModels = data.models;
    } else if (Array.isArray(data)) {
      rawModels = data;
    }

    const models = rawModels
      .map((m) => m.id ?? m.model)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort();

    if (models.length === 0) {
      return NextResponse.json(
        { error: "提供商返回了空的模型列表", latency },
        { status: 200 }
      );
    }

    // Heuristic categorization
    const EMBED_PATTERNS = /embed|bge|e5|voyage|nomic|gte|jina|sentence/;
    const embedding = models.filter((m) => EMBED_PATTERNS.test(m.toLowerCase()));
    const chat = models.filter((m) => !EMBED_PATTERNS.test(m.toLowerCase()));

    return NextResponse.json({
      ok: true,
      models,
      chat,
      embedding,
      count: models.length,
      latency,
    });
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : "连接失败";
    return NextResponse.json({ error: msg, latency }, { status: 200 });
  }
}
