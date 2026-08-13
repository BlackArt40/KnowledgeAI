// ---------------------------------------------------------------------------
// sync.js - workspace -> knowledge base sync for the VS Code extension.
//
// Collects code/text files from the workspace (respecting ignore dirs and
// size caps) and uploads them as KB documents via
// POST /api/v1/knowledge-bases/[id]/documents (kb:write API key).
// Pure Node module (no `vscode` imports) - unit-testable standalone.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_INCLUDE =
  "**/*.{md,txt,js,jsx,ts,tsx,py,java,go,rs,c,cpp,h,hpp,cs,json,yaml,yml,toml,html,css,scss,sql,sh}";
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", ".next", "coverage", ".uploads"]);
const MAX_FILES = 100;
const MAX_BYTES_PER_FILE = 200 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function matchesInclude(relPath, pattern) {
  // The extension ships a glob-ish pattern (extensions list); implement the
  // `**/*.{ext,ext2}` form used by DEFAULT_INCLUDE.
  const m = pattern.match(/^\*\*\/\*\.\{([^}]+)\}$/);
  if (!m) return true;
  const exts = m[1].split(",").map((e) => e.trim());
  const ext = path.extname(relPath).replace(/^\./, "").toLowerCase();
  return exts.includes(ext);
}

/** Recursively collect workspace files (sorted, capped). */
async function collectFiles(root, { include = DEFAULT_INCLUDE, maxFiles = MAX_FILES } = {}) {
  const out = [];
  let total = 0;

  async function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        await walk(full);
        continue;
      }
      if (!e.isFile() || !matchesInclude(rel, include)) continue;
      let stat;
      try {
        stat = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_BYTES_PER_FILE || total + stat.size > MAX_TOTAL_BYTES) continue;
      let content;
      try {
        content = await fs.promises.readFile(full, "utf8");
      } catch {
        continue; // binary / unreadable
      }
      out.push({ name: rel, size: content.length, content });
      total += stat.size;
    }
  }

  await walk(root);
  return out;
}

/** Upload collected files to a KB (deduped by name server-side). */
async function syncWorkspaceToKb({ endpoint, apiKey, kbId, files, onProgress }) {
  const base = String(endpoint || "http://localhost:3000").replace(/\/+$/, "");
  const imported = [];
  const skipped = [];
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const res = await fetch(`${base}/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: f.name, content: f.content }),
      });
      if (res.status === 201) imported.push(f.name);
      else skipped.push(f.name); // duplicate name -> 400-ish is fine to skip
      if (onProgress) onProgress(i + 1, files.length, f.name, imported.length);
    } catch {
      failed.push(f.name);
    }
  }
  return { imported, skipped, failed };
}

module.exports = { collectFiles, syncWorkspaceToKb, DEFAULT_INCLUDE, IGNORE_DIRS };
