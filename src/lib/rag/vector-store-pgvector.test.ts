// pgvector store: schema bootstrap, HNSW dimension guard, DDL race tolerance,
// and missing-table tolerance. The DB client is mocked - no live Postgres.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  exec: vi.fn(async (..._args: unknown[]) => 0),
  query: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
}));

vi.mock("@/lib/db/client", () => ({
  isDbEnabled: () => mocks.enabled,
  getDb: async () => ({
    $executeRawUnsafe: mocks.exec,
    $queryRawUnsafe: mocks.query,
  }),
}));

vi.mock("@/lib/obs/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Fresh module per test - the store keeps a module-level schema cache. */
async function newStore() {
  vi.resetModules();
  const mod = await import("./vector-store-pgvector");
  return new mod.PgVectorStore();
}

const V = (n: number, dim = 1024) =>
  Array.from({ length: n }, () => Float32Array.from({ length: dim }, () => 0.1));

function sqlCalls(): string[] {
  return mocks.exec.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  mocks.enabled = true;
  mocks.exec.mockReset();
  mocks.exec.mockImplementation(async () => 0);
  mocks.query.mockReset();
  mocks.query.mockImplementation(async () => []);
});

describe("schema bootstrap", () => {
  it("creates table + btree indexes, then clears and inserts chunks", async () => {
    const store = await newStore();
    await store.indexChunks("kb_1", "doc_1", "a.md", ["c1", "c2"], V(2));

    const sqls = sqlCalls();
    expect(sqls[0]).toContain("CREATE TABLE IF NOT EXISTS kb_chunks");
    expect(sqls[0]).toContain("vector(1024)");
    expect(sqls.some((s) => s.includes("idx_kb_chunks_kb"))).toBe(true);
    expect(sqls.some((s) => s.includes("idx_kb_chunks_doc"))).toBe(true);

    const deleteIdx = sqls.findIndex((s) => s.startsWith("DELETE FROM kb_chunks"));
    const insertIdx = sqls.findIndex((s) => s.startsWith("INSERT INTO kb_chunks"));
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(deleteIdx);
    expect(sqls.filter((s) => s.startsWith("INSERT INTO kb_chunks"))).toHaveLength(2);
  });

  it("creates the HNSW index when dim <= 2000", async () => {
    const store = await newStore();
    await store.indexChunks("kb_1", "doc_1", "a.md", ["c1"], V(1, 1536));
    expect(sqlCalls().some((s) => s.includes("USING hnsw"))).toBe(true);
  });

  it("skips HNSW above the pgvector 2000-dim limit but still indexes", async () => {
    const store = await newStore();
    await store.indexChunks("kb_1", "doc_1", "a.md", ["c1"], V(1, 4096));

    const sqls = sqlCalls();
    expect(sqls[0]).toContain("vector(4096)");
    expect(sqls.some((s) => s.includes("USING hnsw"))).toBe(false);
    // exact scan fallback still writes the row
    expect(sqls.some((s) => s.startsWith("INSERT INTO kb_chunks"))).toBe(true);
  });

  it("tolerates a concurrent CREATE race (23505) from another process", async () => {
    const store = await newStore();
    mocks.exec.mockImplementationOnce(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });
    await expect(
      store.indexChunks("kb_1", "doc_1", "a.md", ["c1"], V(1))
    ).resolves.toBeUndefined();
    expect(sqlCalls().some((s) => s.startsWith("INSERT INTO kb_chunks"))).toBe(true);
  });

  it("rejects an invalid embedding dimension before touching the DB", async () => {
    const store = await newStore();
    const bad = [Float32Array.from({ length: 20_000 }, () => 0)];
    await expect(store.indexChunks("kb", "doc", "a.md", ["c"], bad)).rejects.toThrow(
      /invalid pgvector dimension/
    );
  });
});

describe("missing-table tolerance", () => {
  it("clearDoc is a no-op when the table does not exist (42P01)", async () => {
    const store = await newStore();
    mocks.exec.mockRejectedValueOnce(
      Object.assign(new Error('relation "kb_chunks" does not exist'), { code: "42P01" })
    );
    await expect(store.clearDoc("kb_1", "doc_1")).resolves.toBeUndefined();
  });

  it("clearKb is a no-op when the table does not exist (42P01)", async () => {
    const store = await newStore();
    mocks.exec.mockRejectedValueOnce(
      Object.assign(new Error('relation "kb_chunks" does not exist'), { code: "42P01" })
    );
    await expect(store.clearKb("kb_1")).resolves.toBeUndefined();
  });

  it("search returns [] when the table does not exist (42P01)", async () => {
    const store = await newStore();
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('relation "kb_chunks" does not exist'), { code: "42P01" })
    );
    await expect(store.search("kb_1", Float32Array.from([0.1]), 5)).resolves.toEqual([]);
  });

  it("chunkCount returns 0 when the table does not exist (42P01)", async () => {
    const store = await newStore();
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('relation "kb_chunks" does not exist'), { code: "42P01" })
    );
    await expect(store.chunkCount("kb_1")).resolves.toBe(0);
  });
});

describe("search", () => {
  it("maps pgvector rows to SearchResult", async () => {
    const store = await newStore();
    mocks.query.mockResolvedValueOnce([
      { id: "c1", doc_id: "doc_1", doc_name: "a.md", chunk_index: 0, text: "hello", similarity: 0.87 },
    ]);
    const hits = await store.search("kb_1", Float32Array.from([0.1, 0.2]), 3);
    expect(hits).toEqual([
      { docId: "doc_1", docName: "a.md", chunkIndex: 0, text: "hello", score: 0.87 },
    ]);
  });

  it("returns [] on an embedding dimension mismatch instead of throwing", async () => {
    const store = await newStore();
    mocks.query.mockRejectedValueOnce(
      new Error("different vector dimensions 1024 and 4096")
    );
    await expect(store.search("kb_1", Float32Array.from([0.1]), 3)).resolves.toEqual([]);
  });

  it("returns 0 rows without a database configured", async () => {
    const store = await newStore();
    mocks.enabled = false;
    await expect(store.search("kb_1", Float32Array.from([0.1]), 3)).resolves.toEqual([]);
    await expect(store.chunkCount("kb_1")).resolves.toBe(0);
  });
});
