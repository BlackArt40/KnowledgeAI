// ---------------------------------------------------------------------------
// KnowledgeAI JavaScript SDK (P7-1) - zero dependencies, works in Node 18+
// and modern browsers (uses global fetch + ReadableStream).
//
// Usage:
//   import { KnowledgeAI } from "./kai-sdk.mjs";
//   const kai = new KnowledgeAI({ apiKey: "kai_sk_...", baseUrl: "http://localhost:3000" });
//   const { kbs } = await kai.listKnowledgeBases();
//   await kai.ask("kb_xxx", "产品支持哪些格式？", { onToken: (t) => process.stdout.write(t) });
// ---------------------------------------------------------------------------

export class KnowledgeAIError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "KnowledgeAIError";
    this.status = status;
    this.body = body;
  }
}

export class KnowledgeAI {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey - API key (kai_sk_...) or session JWT
   * @param {string} [opts.baseUrl] - server origin, default http://localhost:3000
   * @param {number} [opts.timeoutMs] - request timeout for non-SSE calls
   */
  constructor(opts) {
    if (!opts || !opts.apiKey) throw new Error("KnowledgeAI: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs || 60_000;
  }

  headers(json = false) {
    const h = { Authorization: `Bearer ${this.apiKey}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async request(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new KnowledgeAIError(
          data?.error || `HTTP ${res.status}`,
          res.status,
          data
        );
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /api/v1/me - identity of the authenticated caller. */
  async me() {
    return this.request("GET", "/api/v1/me");
  }

  /** GET /api/v1/knowledge-bases - list KBs in the workspace. */
  async listKnowledgeBases() {
    return this.request("GET", "/api/v1/knowledge-bases");
  }

  /** POST /api/v1/knowledge-bases - create a KB. */
  async createKnowledgeBase({ name, desc = "", color }) {
    return this.request("POST", "/api/v1/knowledge-bases", { name, desc, color });
  }

  /**
   * POST /api/v1/chat - streamed Q&A over SSE.
   * @param {string} kbId
   * @param {string} query
   * @param {object} [opts]
   * @param {(token: string) => void} [opts.onToken]
   * @param {(sources: unknown[]) => void} [opts.onSources]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{ messageId: string|null, conversationId: string, citations: unknown[], followUps: unknown[] }>}
   */
  async ask(kbId, query, opts = {}) {
    const ctrl = opts.signal ? null : new AbortController();
    const timer = setTimeout(() => ctrl?.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ kbId, query, webSearch: opts.webSearch }),
        signal: opts.signal ?? ctrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new KnowledgeAIError(data?.error || `HTTP ${res.status}`, res.status, data);
      }
      if (!res.body) throw new KnowledgeAIError("SSE 无响应体", 0, null);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = { messageId: null, conversationId: null, citations: [], followUps: [] };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim());
          if (event.type === "sources" && opts.onSources) opts.onSources(event.chunks);
          if (event.type === "token" && opts.onToken) opts.onToken(event.text);
          if (event.type === "done") {
            result = {
              messageId: event.messageId ?? null,
              conversationId: event.conversationId,
              citations: event.citations ?? [],
              followUps: event.followUps ?? [],
            };
          }
          if (event.type === "error") {
            throw new KnowledgeAIError(event.message || "问答失败", 0, event);
          }
        }
      }
      return result;
    } finally {
      if (ctrl) clearTimeout(timer);
    }
  }

  /**
   * POST /api/v1/agent/run - streamed agent research over SSE.
   * @param {string} topic
   * @param {object} [opts]
   * @param {(step: unknown) => void} [opts.onStep]
   * @returns {Promise<unknown>} the final task
   */
  async runAgent(topic, opts = {}) {
    const res = await fetch(`${this.baseUrl}/api/v1/agent/run`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ topic }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new KnowledgeAIError(data?.error || `HTTP ${res.status}`, res.status, data);
    }
    if (!res.body) throw new KnowledgeAIError("SSE 无响应体", 0, null);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let task = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === "step" && opts.onStep) opts.onStep(event.step);
        if (event.type === "done") task = event.task;
        if (event.type === "error") throw new KnowledgeAIError(event.message || "Agent 执行失败", 0, event);
      }
    }
    return task;
  }

  /** GET /api/v1/webhooks - list webhook subscriptions. */
  async listWebhooks() {
    return this.request("GET", "/api/v1/webhooks");
  }

  /** POST /api/v1/webhooks - create a subscription. */
  async createWebhook({ name, url, secret = "", events }) {
    return this.request("POST", "/api/v1/webhooks", { name, url, secret, events });
  }

  /** DELETE /api/v1/webhooks/{id} */
  async deleteWebhook(id) {
    return this.request("DELETE", `/api/v1/webhooks/${id}`);
  }
}

export default KnowledgeAI;
