import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { resolveSafeModelBaseUrl } from "@/lib/security/ssrf";
export const dynamic = "force-dynamic";

// POST /api/models/fetch-list  { apiKey, baseUrl }
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { apiKey?: string; baseUrl?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const baseUrl = (body.baseUrl ?? "").replace(/\/$/, "");
  const apiKey = body.apiKey ?? "";
  if (!baseUrl) return NextResponse.json({ error: "Base URL 不能为空" }, { status: 400 });

  // F1: GET {baseUrl}/models is server-side and user-controlled - SSRF guard.
  // The validated URL object is what we actually request (never the raw input).
  let target: string;
  try {
    target = (await resolveSafeModelBaseUrl(baseUrl)).toString().replace(/\/$/, "");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "模型地址不被允许" },
      { status: 400 }
    );
  }

  const start = Date.now();

  try {
    // Security review P0: a public host can 302 to the cloud metadata service,
    // so redirects MUST be followed manually and every hop re-validated with
    // the same SSRF policy (see src/lib/security/ssrf.ts).
    const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
    const MAX_REDIRECTS = 3;
    let requestUrl = `${target}/models`;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(requestUrl, {
        method: "GET",
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      if (!REDIRECT_STATUS.has(res.status)) break;
      const location = res.headers.get("location");
      if (!location) {
        return NextResponse.json({ error: `HTTP ${res.status}（重定向缺少 Location）`, latency: Date.now() - start }, { status: 502 });
      }
      // Follow the Location as-is (RFC 7231), but validate the hop first.
      const next = new URL(location, requestUrl).toString();
      try {
        await resolveSafeModelBaseUrl(next);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "重定向目标不被允许" },
          { status: 400 }
        );
      }
      requestUrl = next;
      if (hop === MAX_REDIRECTS) {
        return NextResponse.json({ error: "重定向次数过多", latency: Date.now() - start }, { status: 502 });
      }
    }
    if (!res) {
      return NextResponse.json({ error: "连接失败", latency: Date.now() - start }, { status: 502 });
    }
    const latency = Date.now() - start;
    if (!res.ok) {
      // Never echo the upstream body: it can contain internal host names or
      // metadata responses (the original SSRF leak channel).
      return NextResponse.json({ error: `HTTP ${res.status}`, latency });
    }

    const data = await res.json();
    let rawModels: { id?: string; model?: string }[] = [];
    if (Array.isArray(data?.data)) rawModels = data.data;
    else if (Array.isArray(data?.models)) rawModels = data.models;
    else if (Array.isArray(data)) rawModels = data;

    const models = rawModels
      .map((m) => m.id ?? m.model)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort();

    if (models.length === 0)
      return NextResponse.json({ error: "提供商返回了空的模型列表", latency });

    const EMBED_PATTERNS = /embed|bge|e5|voyage|nomic|gte|jina|sentence/;
    const embedding = models.filter((m) => EMBED_PATTERNS.test(m.toLowerCase()));
    const chat = models.filter((m) => !EMBED_PATTERNS.test(m.toLowerCase()));

    return NextResponse.json({ ok: true, models, chat, embedding, count: models.length, latency });
  } catch {
    const latency = Date.now() - start;
    // Generic message: err.message can leak internal hostnames / DNS details.
    return NextResponse.json({ error: "连接失败", latency });
  }
}
