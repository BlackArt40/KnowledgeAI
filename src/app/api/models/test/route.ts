import { NextResponse } from "next/server";
import { getModel, setTestResult, sanitize } from "@/lib/models/store";
export const dynamic = "force-dynamic";

// POST /api/models/test  { id }  or  { provider, apiKey, baseUrl, chatModel }
// Tests the connection by sending a minimal chat completion request.
export async function POST(req: Request) {
  let body: {
    id?: string;
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    chatModel?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  // Resolve config: from stored model, or from inline body (test-before-save)
  let baseUrl: string;
  let apiKey: string;
  let chatModel: string;
  let modelId: string | null = null;

  if (body.id) {
    const m = getModel(body.id);
    if (!m) return NextResponse.json({ error: "模型配置不存在" }, { status: 404 });
    baseUrl = m.baseUrl;
    apiKey = m.apiKey;
    chatModel = m.chatModel;
    modelId = m.id;
  } else {
    baseUrl = (body.baseUrl ?? "").replace(/\/$/, "");
    apiKey = body.apiKey ?? "";
    chatModel = body.chatModel ?? "";
    if (!baseUrl || !chatModel) {
      return NextResponse.json({ error: "baseUrl 和 chatModel 必填" }, { status: 400 });
    }
  }

  const url = `${baseUrl}/chat/completions`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = text.slice(0, 200);
      if (modelId) setTestResult(modelId, false);
      return NextResponse.json(
        { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`, latency },
        { status: 200 }
      );
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? "";
    if (modelId) {
      setTestResult(modelId, true);
      return NextResponse.json({ ok: true, reply: String(reply).slice(0, 100), latency, model: sanitize(getModel(modelId)!) });
    }
    return NextResponse.json({ ok: true, reply: String(reply).slice(0, 100), latency });
  } catch (err) {
    const latency = Date.now() - start;
    if (modelId) setTestResult(modelId, false);
    const msg = err instanceof Error ? err.message : "连接失败";
    return NextResponse.json({ ok: false, error: msg, latency }, { status: 200 });
  }
}
