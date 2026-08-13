#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copies swagger-ui-dist static assets from node_modules into
// public/vendor/swagger-ui/ so the interactive API docs (/docs) work in dev,
// CI and the Docker standalone build alike - without reading node_modules at
// request time (Next standalone traces only statically-referenced files).
//
// Runs from the package "postinstall" hook and the Dockerfile build stage.
// Idempotent; safe to re-run.
// ---------------------------------------------------------------------------
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "node_modules", "swagger-ui-dist");
const dest = join(root, "public", "vendor", "swagger-ui");

if (!existsSync(join(src, "swagger-ui-bundle.js"))) {
  console.error("[copy-swagger-ui] swagger-ui-dist not installed - run `pnpm install` first.");
  process.exit(1);
}

const FILES = [
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js",
  "swagger-ui.css",
  "swagger-ui-bundle.js.map",
  "swagger-ui-standalone-preset.js.map",
  "swagger-ui.css.map",
  "favicon-32x32.png",
];

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of FILES) {
  cpSync(join(src, f), join(dest, f));
}
console.log(`[copy-swagger-ui] ${FILES.length} assets -> public/vendor/swagger-ui/`);
