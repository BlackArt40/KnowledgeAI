// ---------------------------------------------------------------------------
// PineconeVectorStore - managed Pinecone vector store adapter (Serverless).
//
// Requires:
//   1. A Pinecone account + serverless index (pre-created with correct dim)
//   2. VECTOR_STORE=pinecone in .env.local
//   3. PINECONE_API_KEY  - your Pinecone API key
//   4. PINECONE_INDEX_HOST  - e.g. "https://idx-abc.svc.us-east1-aws.pinecone.io"
//      (or PINECONE_INDEX_NAME - auto-resolved to host via control plane API)
//
// Uses Pinecone Data Plane REST API directly via fetch (no npm dependency).
// Each KB maps to a Pinecone namespace "kai_{kbId}" for per-KB isolation.
// ---------------------------------------------------------------------------

import type { VectorStore, SearchResult } from "./vector-store-interface";

// ── Configuration ────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.PINECONE_API_KEY;
  if (!key) throw new Error("PINECONE_API_KEY not set (required for VECTOR_STORE=pinecone)");
  return key;
}

/** Namespace for a given KB. */
function nsName(kbId: string): string {
  return `kai_${kbId}`;
}

let _resolvedHost: string | null = null;

/** Resolve the Pinecone index host URL. */
async function getHost(): Promise<string> {
  if (_resolvedHost) return _resolvedHost;

  // Direct host takes priority
  const directHost = process.env.PINECONE_INDEX_HOST;
  if (directHost) {
    _resolvedHost = directHost.replace(/\/+$/, "");
    return _resolvedHost;
  }

  // Resolve from index name via control plane API
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    throw new Error(
      "PINECONE_INDEX_HOST or PINECONE_INDEX_NAME must be set (required for VECTOR_STORE=pinecone)"
    );
  }

  const res = await fetch(`https://api.pinecone.io/indexes/${encodeURIComponent(indexName)}`, {
    headers: { "Api-Key": getApiKey() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pinecone resolve host ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const host: string = data.host;
  if (!host) throw new Error(`Pinecone index "${indexName}" has no host field`);
  _resolvedHost = `https://${host}`;
  console.log(`[rag] Pinecone index host resolved: ${_resolvedHost}`);
  return _resolvedHost;
}

// ── Internal helpers ─────────────────────────────────────────────────────

/** Fetch wrapper for Pinecone data plane API. */
async function pineconeFetch(
  path: string,
  body: unknown,
  method = "POST"
): Promise<Response> {
  const host = await getHost();
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Api-Key": getApiKey(),
      "X-Pinecone-API-Version": "2024-07",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinecone ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return res;
}

/** Metadata schema for Pinecone vectors. */
interface ChunkMetadata {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
}

// ── PineconeVectorStore ──────────────────────────────────────────────────

export class PineconeVectorStore implements VectorStore {
  async indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void> {
    const namespace = nsName(kbId);

    // Remove existing chunks for this doc first (re-index safe)
    await this.clearDoc(kbId, docId);

    if (chunks.length === 0) return;

    // Build upsert vectors
    const pineconeVectors = chunks.map((text, i) => ({
      id: `${docId}_${i}`,
      values: Array.from(vectors[i]),
      metadata: {
        docId,
        docName,
        chunkIndex: i,
        text,
      } as ChunkMetadata,
    }));

    // Pinecone upsert limit: 1000 vectors per request (with 2048-dim)
    const BATCH_SIZE = 100;
    for (let i = 0; i < pineconeVectors.length; i += BATCH_SIZE) {
      const batch = pineconeVectors.slice(i, i + BATCH_SIZE);
      await pineconeFetch("/vectors/upsert", {
        vectors: batch,
        namespace,
      });
    }
  }

  async clearDoc(kbId: string, docId: string): Promise<void> {
    const namespace = nsName(kbId);
    try {
      await pineconeFetch("/vectors/delete", {
        namespace,
        filter: { docId: { $eq: docId } },
      });
    } catch {
      // Ignore errors (namespace may not exist yet)
    }
  }

  async clearKb(kbId: string): Promise<void> {
    const namespace = nsName(kbId);
    try {
      await pineconeFetch("/vectors/delete", {
        namespace,
        deleteAll: true,
      });
    } catch {
      // Ignore errors (namespace may not exist)
    }
  }

  async search(
    kbId: string,
    queryVec: Float32Array,
    topK: number
  ): Promise<SearchResult[]> {
    const namespace = nsName(kbId);

    const res = await pineconeFetch("/query", {
      vector: Array.from(queryVec),
      topK,
      namespace,
      includeMetadata: true,
      includeValues: false,
    });

    const data = await res.json();
    const matches: Array<{
      id: string;
      score: number;
      metadata?: ChunkMetadata;
    }> = data.matches ?? [];

    return matches
      .filter((m) => m.metadata)
      .map((m) => ({
        docId: m.metadata!.docId,
        docName: m.metadata!.docName,
        chunkIndex: m.metadata!.chunkIndex,
        text: m.metadata!.text,
        score: m.score,
      }));
  }

  async chunkCount(kbId: string): Promise<number> {
    const namespace = nsName(kbId);
    try {
      const res = await pineconeFetch("/describe_index_stats", {});
      const data = await res.json();
      const namespaces: Record<string, { vectorCount?: number }> = data.namespaces ?? {};
      return namespaces[namespace]?.vectorCount ?? 0;
    } catch {
      return 0;
    }
  }
}
