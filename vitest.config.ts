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
      skipFull: true,
      thresholds: {
        // Global floor: measured total (65.2 lines) minus 2. Modules that
        // nobody owns still have to clear this.
        ...floor(63, 60, 64, 51),

        // ── P0: money / identity / tenant boundary / cited answers ────────
        "src/lib/auth/**": floor(94, 91, 95, 87),
        "src/lib/billing/**": floor(89, 87, 92, 72),
        "src/lib/team/**": floor(96, 93, 96, 83),
        "src/lib/workspace/**": floor(92, 94, 96, 66),
        "src/lib/apikeys/**": floor(97, 93, 98, 92),
        "src/lib/rag/**": floor(88, 86, 93, 78),
        // PII in provider error bodies: redaction is a single 40-line module,
        // so it is held near-total instead of at the directory average.
        "src/lib/obs/redact.ts": floor(95, 95, 95, 90),

        // ── P1: availability / data integrity (raised to 70 in batch 2) ───
        "src/lib/db/**": floor(34, 33, 44, 24),
        "src/lib/queue/**": floor(45, 44, 51, 33),
        "src/lib/agent/**": floor(49, 46, 42, 44),
        "src/lib/chat/**": floor(26, 23, 18, 17),
        "src/lib/kb/**": floor(66, 63, 69, 49),
        "src/lib/security/**": floor(69, 66, 70, 66),
        "src/lib/storage/**": floor(11, 11, 15, 8),
        "src/lib/upload/**": floor(0, 0, 0, 0),
        "src/lib/collab/**": floor(87, 83, 82, 74),
        "src/lib/webhooks/**": floor(92, 87, 88, 82),
        "src/lib/realtime/**": floor(90, 89, 91, 75),
        "src/lib/llm/**": floor(83, 85, 82, 68),
        "src/lib/health/**": floor(79, 78, 86, 71),
        "src/lib/admin/**": floor(74, 69, 63, 46),
        "src/lib/notifications/**": floor(96, 91, 93, 67),
        "src/lib/integrations/**": floor(59, 57, 50, 51),
        "src/lib/kg/**": floor(93, 91, 93, 76),
        "src/lib/models/**": floor(66, 54, 45, 44),

        // ── P2: statistics only (no threshold) — external / email / theme /
        // voice / i18n / marketing / validation / openapi / obs. They roll up
        // into the global floor above.

        // Top-level helpers (rate-limit, config, crypto, secrets, sse, ...).
        "src/lib/*.ts": floor(57, 55, 60, 42),
      },
    },
  },
});
