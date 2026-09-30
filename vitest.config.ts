// P6-3: Vitest config - unit tests for core lib modules with coverage
// thresholds. Coverage scope: RAG / auth / billing / team (acceptance:
// > 70% lines/functions/statements, branches >= 60). ocr.ts is excluded
// (needs tesseract binaries + filesystem fixtures - documented in ROADMAP).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

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
      include: ["src/lib/rag/**", "src/lib/auth/**", "src/lib/billing/**", "src/lib/team/**"],
      // External-service backends (chromadb/pinecone) and pure type
      // files are excluded - they need live services or contain no runtime
      // code (documented in ROADMAP). ocr.ts needs tesseract binaries.
      exclude: [
        "src/lib/rag/ocr.ts",
        "src/lib/rag/vector-store-chromadb.ts",
        "src/lib/rag/vector-store-pinecone.ts",
        "src/lib/rag/vector-store-interface.ts",
        "src/lib/rag/types.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
