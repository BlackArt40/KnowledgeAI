// @ts-nocheck
// ---------------------------------------------------------------------------
// Vector Store Migration Script
//
// Migrates all KB document indexes from the in-memory store into a target
// vector database (pgvector / chromadb / pinecone).
//
// Usage:
//   MIGRATE_TO=chromadb npx tsx scripts/migrate-vector-store.ts
//   MIGRATE_TO=pinecone  npx tsx scripts/migrate-vector-store.ts
//   MIGRATE_TO=pgvector  npx tsx scripts/migrate-vector-store.ts
//
// Options:
//   --dry-run    Preview what would be migrated without writing
//   --kb <id>    Migrate only the specified KB
//
// Prerequisites (target-specific env vars):
//   pgvector:  DATABASE_URL
//   chromadb:  CHROMA_URL (default http://localhost:8000)
//   pinecone:  PINECONE_API_KEY + PINECONE_INDEX_HOST (or PINECONE_INDEX_NAME)
//
// The script instantiates the target VectorStore directly (bypassing the
// factory singleton) so it runs independently of the app's VECTOR_STORE setting.
// ---------------------------------------------------------------------------

import { chunkText } from "../src/lib/rag/chunker";
import { embed as localEmbed } from "../src/lib/rag/embeddings";
import type { VectorStore } from "../src/lib/rag/vector-store-interface";

// ── Embedding helper (LLM if configured, else local hash) ────────────────

async function embedBatchSafe(texts: string[]): Promise<Float32Array[]> {
  try {
    const { embedBatch } = await import("../src/lib/llm/provider");
    return await embedBatch(texts);
  } catch {
    return texts.map((t) => localEmbed(t));
  }
}

// ── Target store factory ─────────────────────────────────────────────────

async function createTargetStore(target: string): Promise<VectorStore> {
  switch (target) {
    case "chromadb": {
      const { ChromaVectorStore } = await import("../src/lib/rag/vector-store-chromadb");
      return new ChromaVectorStore();
    }
    case "pinecone": {
      const { PineconeVectorStore } = await import("../src/lib/rag/vector-store-pinecone");
      return new PineconeVectorStore();
    }
    case "pgvector": {
      const { PgVectorStore } = await import("../src/lib/rag/vector-store-pgvector");
      return new PgVectorStore();
    }
    default:
      throw new Error(`Unknown target "${target}". Use: chromadb, pgvector, or pinecone`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const target = process.env.MIGRATE_TO;
  const dryRun = process.argv.includes("--dry-run");
  const kbFilterIdx = process.argv.indexOf("--kb");
  const kbFilter = kbFilterIdx >= 0 ? process.argv[kbFilterIdx + 1] : undefined;

  if (!target) {
    console.error("Usage: MIGRATE_TO=<chromadb|pgvector|pinecone> npx tsx scripts/migrate-vector-store.ts [--dry-run] [--kb <id>]");
    process.exit(1);
  }

  // Force memory mode for source reading (KB seed indexes into memory)
  process.env.VECTOR_STORE = "memory";

  // Hydrate from DB if available (loads real KBs/docs)
  if (process.env.DATABASE_URL) {
    console.log("[migrate] Hydrating from database...");
    const { ensureHydrated } = await import("../src/lib/db/hydrate");
    await ensureHydrated();
    await new Promise((r) => setTimeout(r, 500)); // let fire-and-forget seed indexing settle
  }

  // Read all KBs and documents
  const { listAllKbs, listDocuments } = await import("../src/lib/kb/store");
  let kbs = listAllKbs();
  if (kbFilter) kbs = kbs.filter((k: any) => k.id === kbFilter);

  console.log(`[migrate] Source: in-memory KB store (${kbs.length} KBs)`);
  console.log(`[migrate] Target: ${target}${dryRun ? " (dry-run)" : ""}`);
  console.log("");

  // Instantiate target store
  let targetStore: VectorStore | null = null;
  if (!dryRun) {
    targetStore = await createTargetStore(target);
  }

  let totalDocs = 0;
  let totalChunks = 0;
  let skipped = 0;
  const start = Date.now();

  for (const kb of kbs) {
    const docs = listDocuments(kb.id);
    const readyDocs = docs.filter((d: any) => d.content && d.content.trim());
    if (readyDocs.length === 0) continue;

    console.log(`  📁 KB: ${kb.name} (${readyDocs.length} docs with content)`);

    for (const doc of readyDocs) {
      try {
        const chunks = chunkText(
          doc.content,
          kb.settings.chunkSize || 500,
          kb.settings.chunkOverlap || 50
        );

        if (dryRun) {
          totalChunks += chunks.length;
          totalDocs++;
          console.log(`     ✓ [dry-run] ${doc.name} → ${chunks.length} chunks`);
          continue;
        }

        const vectors = await embedBatchSafe(chunks);
        await targetStore!.indexChunks(kb.id, doc.id, doc.name, chunks, vectors);
        totalChunks += chunks.length;
        totalDocs++;
        console.log(`     ✅ ${doc.name} (${chunks.length} chunks)`);
      } catch (err: any) {
        skipped++;
        console.error(`     ❌ ${doc.name}: ${err.message || err}`);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("");
  if (dryRun) {
    console.log(`[migrate] 📋 Dry-run complete in ${elapsed}s`);
  } else {
    console.log(`[migrate] ✅ Migration complete in ${elapsed}s`);
  }
  console.log(`[migrate] KBs: ${kbs.length}, Docs: ${totalDocs}, Chunks: ${totalChunks}, Skipped: ${skipped}`);

  if (!dryRun && totalChunks > 0) {
    // Verify by counting chunks in target
    console.log("");
    console.log("[migrate] Verifying...");
    for (const kb of kbs) {
      const count = await targetStore!.chunkCount(kb.id);
      if (count > 0) console.log(`  ✓ KB "${kb.name}": ${count} chunks in target`);
    }
  }
}

main().catch((err) => {
  console.error("[migrate] ❌ Error:", err);
  process.exit(1);
});
