// ---------------------------------------------------------------------------
// ask.js - KnowledgeAI API client shared by the VS Code extension commands.
//
// Pure Node module (no `vscode` imports) so it can be unit-tested standalone
// with plain `node` / run by scripts/smoke/test-vscode.ts against a live
// server. SSE framing is the same protocol as the Chrome extension.
// ---------------------------------------------------------------------------

"use strict";

/** Ask a question against a KB via /api/v1/chat (SSE stream).
 *  @param {{endpoint: string, apiKey: string, kbId: string, query: string}} opts
 *  @returns {Promise<{answer: string, sources: unknown[]}>}
 */
async function askOnce({ endpoint, apiKey, kbId, query }) {
  const base = String(endpoint || "http://localhost:3000").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ kbId, query }),
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`HTTP ${res.status} ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let sources = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "token") answer += ev.text || ev.token || "";
      else if (ev.type === "error") throw new Error(ev.error || "问答失败");
      else if (ev.type === "done") sources = ev.sources ?? [];
    }
  }
  return { answer, sources };
}

module.exports = { askOnce };
