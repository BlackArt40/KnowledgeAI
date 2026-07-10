import { NextResponse } from "next/server";
import { getModel, setTestResult, sanitize } from "@/lib/models/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// POST /api/models/test  { id }  or  { provider, apiKey, baseUrl, chatModel }
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { id?: string; apiKey?: string; baseUrl?: string; chatModel?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  let baseUrl: string, apiKey: string, chatModel: string, modelId: string | null = null;

  if (body.id) {
    const m = getModel(u.id, body.id);
    if (!m) return NextResponse.json({ error: "模型配置不存在" }, { status: 404 });
    baseUrl = m.baseUrl; apiKey = m.apiKey; chatModel = m.chatModel; modelId = m.id;
  } else {
    baseUrl = (body.baseUrl ?? "").replace(/\/$/, "");
    apiKey = body.apiKey ?? ""; chatModel = body.chatModel ?? "";
    if (!baseUrl || !chatModel)
      return NextResponse.json({ error: "baseUrl 和 chatModel 必填" }, { status: 400 });
  }

  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: chatModel, messages: [{ role: "user", content: "Hi" }], max_tokens: 8, stream: false }),
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (modelId) setTestResult(u.id, modelId, false);
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, latency });
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? "";
    if (modelId) {
      setTestResult(u.id, modelId, true);
      return NextResponse.json({ ok: true, reply: String(reply).slice(0, 100), latency, model: sanitize(getModel(u.id, modelId)!) });
    }
    return NextResponse.json({ ok: true, reply: String(reply).slice(0, 100), latency });
  } catch (err) {
    const latency = Date.now() - start;
    if (modelId) setTestResult(u.id, modelId, false);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "连接失败", latency });
  }
}
