// P6-3 → batch 1: Vitest config - unit tests for the whole `src/lib` surface.
//
// Coverage scope used to be rag/auth/billing/team only, so the largest modules
// (db 3.3k LOC, agent 2.2k, queue 1.5k) were invisible. It now covers every
// module under src/lib with a **ratchet** threshold per directory: each value
// is the measured baseline (2026-11-06, 111 files / 730 tests) minus a 2-point
// margin. CI stays green on the current state and can only move up; never lower
// a number to make a build pass.
//
// P0 (auth / billing / team / workspace / apikeys / rag / obs-redact) is at its
// ≥85 target. P1 (db / queue / agent / chat / kb / security / storage / upload /
// collab / webhooks / realtime / llm / health / admin / notifications /
// integrations / kg / models) sits on its baseline floor and is raised to ≥70
// in batch 2 as the tests land. P2 (external / email / theme / voice / i18n /
// marketing / validation / openapi / obs) is statistics-only.
//
// Excluded on purpose (each needs a live service or has no runtime code):
//   - rag/ocr.ts                      tesseract binaries + filesystem fixtures
//   - rag/vector-store-{chromadb,pinecone,interface}.ts  external backends
//   - rag/types.ts, team/types.ts     type-only modules
//   - every *.test.ts                 the probes themselves
// rag/remote.ts is NOT excluded anymore: remote.test.ts drives the HTTP/SSE
// contract with a stubbed fetch, so the adapter counts like any other module.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

/** Ratchet floor: baseline minus 2 points. */
const floor = (lines: number, statements: number, functions: number, branches: number) => ({
  lines,
  statements,
  functions,
  branches,
});

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
  },
  test: {
    environment: "node",
    include: ["src/lib/**/*.test.ts"],
    // Coverage gates must be deterministic: with one fork per file the V8
    // reports of modules exercised by several test files drifted between runs
    // (workspace/** functions measured 81.5% / 88.9% / 100% for one commit).
    // Vitest 4 replaced poolOptions with this top-level switch; it also runs
    // the whole suite in ~13s instead of ~40s (module cache is shared).
    fileParallelism: false,
    // Cold-start fragility (engineering-assurance 2026-09-30, test debt #24):
    // the RAG suites use dynamic `await import()` of heavy deps (pdfjs-dist /
    // mammoth / xlsx) inside the test body, so on a cold transform cache a
    // single test can blow the 5s default and the whole suite goes red with a
    // timeout - not a logic failure (it always passed on a warm run). 30s is
    // well above the warm-run cost (<100ms) and only bites when something is
    // genuinely stuck.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: [
        "**/*.test.ts",
        "src/lib/rag/ocr.ts",
        "src/lib/rag/vector-store-chromadb.ts",
        "src/lib/rag/vector-store-pinecone.ts",
        "src/lib/rag/vector-store-interface.ts",
        "src/lib/rag/types.ts",
        "src/lib/team/types.ts",
      ],
      reporter: ["text", "text-summary", "json-summary"],
      thresholds: {
        // Floors come from the LOWEST observed run (local + CI), minus 3:
        // some suites take timer/filesystem paths whose line count differs by
        // a few points between machines. The gate is here to catch real
        // regressions, not scheduler noise.
        ...floor(62, 60, 64, 50),

        // ── P0: money / identity / tenant boundary / cited answers ────────
        "src/lib/auth/**": floor(93, 90, 94, 86),
        "src/lib/billing/**": floor(88, 86, 91, 71),
        "src/lib/team/**": floor(95, 92, 95, 82),
        "src/lib/workspace/**": floor(93, 92, 85, 65),
        "src/lib/apikeys/**": floor(96, 92, 97, 91),
        "src/lib/rag/**": floor(87, 85, 92, 77),
        // PII in provider error bodies: redaction is a single 40-line module,
        // so it is held near-total instead of at the directory average.
        "src/lib/obs/redact.ts": floor(97, 97, 97, 97),

        // ── P1: availability / data integrity (raised to 70 in batch 2) ───
        "src/lib/db/**": floor(33, 32, 43, 21),
        "src/lib/queue/**": floor(45, 44, 50, 33),
        "src/lib/agent/**": floor(48, 45, 41, 43),
        "src/lib/chat/**": floor(25, 22, 17, 16),
        "src/lib/kb/**": floor(58, 56, 62, 43),
        "src/lib/security/**": floor(68, 65, 68, 65),
        "src/lib/storage/**": floor(10, 10, 14, 7),
        "src/lib/upload/**": floor(0, 0, 0, 0),
        "src/lib/collab/**": floor(86, 82, 81, 73),
        "src/lib/webhooks/**": floor(91, 86, 87, 81),
        "src/lib/realtime/**": floor(89, 88, 90, 74),
        "src/lib/llm/**": floor(82, 84, 81, 67),
        "src/lib/health/**": floor(78, 77, 85, 70),
        "src/lib/admin/**": floor(73, 68, 62, 45),
        "src/lib/notifications/**": floor(95, 90, 92, 66),
        "src/lib/integrations/**": floor(58, 56, 49, 50),
        "src/lib/kg/**": floor(92, 90, 92, 75),
        "src/lib/models/**": floor(65, 53, 44, 43),

        // ── P2: statistics only (no threshold) — external / email / theme /
        // voice / i18n / marketing / validation / openapi / obs. They roll up
        // into the global floor above.

        // Top-level helpers (rate-limit, config, crypto, secrets, sse, ...).
        "src/lib/*.ts": floor(56, 54, 59, 41),
      },
    },
  },
});
