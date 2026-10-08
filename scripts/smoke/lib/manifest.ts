// Inventory of the acceptance smoke scripts, consumed by scripts/smoke/run-all.ts.
//
// Groups describe the runtime prerequisite:
//   lib    - pure library / static scans, no server
//   http   - needs a live dev server at BASE_URL (default http://localhost:3000)
//   limits - needs the server running the DOCUMENTED default rate-limit tiers
//            (anon 20 / kb 60 / user 200 / key 500) - run it in its own step,
//            never alongside a server whose limits were raised for the suite
//   ui     - needs the server + a Chrome/Chromium binary for CDP driving
//   infra  - needs its own extra server/credentials (DB, chromadb, mock OIDC...);
//            excluded from CI, run manually with --group infra
export type SmokeGroup = "lib" | "http" | "limits" | "ui" | "infra";

export type SmokePrereq =
  | "chrome"
  | "ocr"
  | "go"
  | "python"
  | "db"
  | "chromadb"
  | "pinecone-mock";

export interface SmokeEntry {
  id: string;
  group: SmokeGroup;
  /** Overrides `${id}.ts` (e.g. the .tsx renderer test, or the .mjs UI scripts). */
  file?: string;
  prereq?: SmokePrereq[];
  /** Per-script timeout override in ms (default 180000). */
  timeoutMs?: number;
  note?: string;
}

const http = (id: string, extra: Partial<SmokeEntry> = {}): SmokeEntry => ({ id, group: "http", ...extra });
const limits = (id: string, extra: Partial<SmokeEntry> = {}): SmokeEntry => ({ id, group: "limits", timeoutMs: 300000, ...extra });
const lib = (id: string, extra: Partial<SmokeEntry> = {}): SmokeEntry => ({ id, group: "lib", ...extra });
const ui = (id: string, extra: Partial<SmokeEntry> = {}): SmokeEntry => ({ id, group: "ui", file: `${id}.mjs`, timeoutMs: 240000, ...extra });
const infra = (id: string, extra: Partial<SmokeEntry> = {}): SmokeEntry => ({ id, group: "infra", timeoutMs: 300000, ...extra });

export const SMOKE_MANIFEST: SmokeEntry[] = [
  // ── lib: no server ───────────────────────────────────────────────────
  lib("test-2fa", { note: "otplib TOTP + backup codes" }),
  lib("test-agent-graph"),
  lib("test-chat-markdown", { file: "test-chat-markdown.tsx" }),
  lib("test-chunker"),
  lib("test-cleanup"),
  lib("test-conversation"),
  lib("test-external-sources"),
  lib("test-fallback"),
  lib("test-hybrid-search"),
  lib("test-i18n-coverage", { note: "fails the build on residual hardcoded Chinese in src/app + src/components" }),
  lib("test-is-scanned"),
  lib("test-logging-sink"),
  lib("test-parser", { note: "self-skips the OCR assertions when .tessdata/ packs are absent" }),
  lib("test-routing", { note: "self-skips the OCR assertion when .tessdata/ packs are absent" }),
  lib("test-sentry"),
  lib("test-strip-html"),
  lib("verify-imports"),

  // ── http: live server (demo mode) ────────────────────────────────────
  // Order matters: scripts with side effects on the shared in-memory store
  // (test-2fa-http enables 2FA for admin) or that deliberately exhaust a
  // rate-limit window (test-rate-limit) run LAST.
  http("test-audit-encrypt"),
  http("test-chat-enhance"),
  http("test-chunked-upload"),
  http("test-global-search"),
  http("test-graph-rag"),
  http("test-kb-permissions"),
  http("test-logging", { note: "static scan for console.* in server code + /api/admin/logs" }),
  http("test-monitoring"),
  http("test-multimodal", { note: "image-text assertions self-skip when OCR packs are absent" }),
  http("test-openapi"),
  http("test-pwa"),
  http("test-realtime"),
  http("test-report-enhance"),
  http("test-sdk", { prereq: ["go", "python"], note: "runs the JS/Python/Go SDKs against the live server" }),
  http("test-theme"),
  http("test-webhooks", {
    note: "registers a receiver on 127.0.0.1 - needs SSRF_ALLOW_PRIVATE_HOSTS=true on the server and NODE_ENV=development (dev/test only; any other NODE_ENV stays strict)",
  }),
  http("test-workspaces"),

  // ── limits: server must run the DOCUMENTED default tiers ─────────────
  // (anon 20 < kb 60 < user 200 < key 500). The script aligns the admin-store
  // user tier with the env value itself, then restores the demo default.
  limits("test-rate-limit", {
    note: "asserts the tier ordering anon 20 < kb 60 < user 200 < key 500 - run against a server with .env.example defaults, not a raised window",
  }),
  http("test-2fa-http", {
    note: "STATEFUL: leaves admin@knowledgeai.dev with 2FA enabled in the server's in-memory store - keep it LAST in the group, and restart `pnpm dev` before re-running the suite",
  }),

  // ── ui: server + Chrome via CDP ──────────────────────────────────────
  ui("test-chat-enhance-ui", { prereq: ["chrome"] }),
  ui("test-global-search-ui", { prereq: ["chrome"] }),
  ui("test-graph-ui", { prereq: ["chrome"] }),
  ui("test-i18n", { prereq: ["chrome"] }),
  ui("test-mobile-pwa", { prereq: ["chrome"] }),
  ui("test-monitoring-ui", { prereq: ["chrome"] }),
  ui("test-multimodal-ui", { prereq: ["chrome"] }),
  ui("test-theme-ui", { prereq: ["chrome"] }),
  ui("test-widget-ui", { prereq: ["chrome"] }),

  // ── infra: brings its own server / external dependency ───────────────
  infra("test-chromadb", { prereq: ["chromadb"] }),
  infra("test-health", { note: "spawns a second production server to assert the 503 degraded path" }),
  infra("test-integrations", { note: "spawns its own low-rate-limit :3100 instance (explicit CORS allowlist); the F17 assertions on :3000 expect production mode" }),
  infra("test-oauth", { note: "mock OIDC server on :5092 + instance on :3100" }),
  infra("test-ocr-image", { prereq: ["ocr"] }),
  infra("test-ocr-scanned-pdf", { prereq: ["ocr"] }),
  infra("test-persistence", { prereq: ["db"] }),
  infra("test-pinecone", { prereq: ["pinecone-mock"], note: "mock pinecone server on :5080" }),
  infra("test-sync", { note: "mock Notion/Confluence servers on :5090/:5091 + instance on :3100" }),
  infra("test-vscode", { note: "starts its own instance on :3100" }),
];

export const SMOKE_GROUPS: SmokeGroup[] = ["lib", "http", "limits", "ui", "infra"];

/**
 * Groups `--group all` expands to. `limits` is intentionally excluded: it asserts
 * the documented DEFAULT rate-limit tiers (anon 20 < kb 60 < user 200 < key 500),
 * which conflicts with the `--elevate` that http/ui need to avoid 429 cascades in
 * a shared server window - run it explicitly with `--group limits`.
 */
export const SMOKE_ALL_GROUPS: SmokeGroup[] = ["lib", "http", "ui", "infra"];
