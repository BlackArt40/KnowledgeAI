// @ts-nocheck
// Lightweight mock Pinecone data plane server for testing.
// Implements: /vectors/upsert, /query, /vectors/delete, /describe_index_stats
import http from "http";

// In-memory store: namespace -> Map<id, {values, metadata}>
const store = new Map<string, Map<string, { values: number[]; metadata: any }>>();

function getNs(ns: string): Map<string, { values: number[]; metadata: any }> {
  if (!store.has(ns)) store.set(ns, new Map());
  return store.get(ns)!;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const json = body ? JSON.parse(body) : {};
    const ns = json.namespace || "";

    try {
      if (req.url === "/vectors/upsert" && req.method === "POST") {
        const m = getNs(ns);
        for (const v of json.vectors) m.set(v.id, { values: v.values, metadata: v.metadata || {} });
        res.end(JSON.stringify({ upsertedCount: json.vectors.length }));
      } else if (req.url === "/query" && req.method === "POST") {
        const m = getNs(ns);
        const results = [...m.entries()]
          .map(([id, v]) => ({ id, score: cosineSim(json.vector, v.values), metadata: v.metadata }))
          .sort((a, b) => b.score - a.score)
          .slice(0, json.topK || 10);
        res.end(JSON.stringify({ matches: results, namespace: ns }));
      } else if (req.url === "/vectors/delete" && req.method === "POST") {
        const m = getNs(ns);
        if (json.deleteAll) {
          m.clear();
        } else if (json.filter && json.filter.docId) {
          const docId = json.filter.docId.$eq;
          for (const [id, v] of m) if (v.metadata.docId === docId) m.delete(id);
        }
        res.end(JSON.stringify({}));
      } else if (req.url === "/describe_index_stats" && req.method === "POST") {
        const namespaces: Record<string, { vectorCount: number }> = {};
        for (const [name, m] of store) namespaces[name] = { vectorCount: m.size };
        res.end(JSON.stringify({ namespaces, dimension: 2048, indexFullness: 0 }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});

server.listen(5080, () => console.log("[mock-pinecone] listening on :5080"));
