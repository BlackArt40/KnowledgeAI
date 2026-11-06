#!/usr/bin/env node
// Aggregate coverage/coverage-summary.json per src/lib module so a PR can paste
// the numbers instead of asking a reviewer to read the v8 text table.
//
// Usage: node scripts/tools/coverage-by-dir.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const summaryPath = join(root, "coverage", "coverage-summary.json");

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
} catch {
  console.error(`missing ${relative(process.cwd(), summaryPath)} - run \`pnpm test:unit\` first`);
  process.exit(1);
}

const METRICS = ["lines", "statements", "functions", "branches"];

/** Map an absolute file path to its first directory under src/lib. */
function bucketOf(file) {
  const m = /src\/lib\/(?:([^/]+)\/)?/.exec(file);
  if (!m) return null;
  return m[1] ?? "(root)";
}

const buckets = new Map();
for (const [file, data] of Object.entries(summary)) {
  if (file === "total") continue;
  const bucket = bucketOf(file);
  if (!bucket) continue;
  if (!buckets.has(bucket)) {
    buckets.set(bucket, Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }])));
  }
  const agg = buckets.get(bucket);
  for (const m of METRICS) {
    agg[m].covered += data[m].covered;
    agg[m].total += data[m].total;
  }
}

function pct(covered, total) {
  return total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
}

const rows = [...buckets.entries()]
  .map(([dir, agg]) => ({
    dir,
    ...Object.fromEntries(METRICS.map((m) => [m, pct(agg[m].covered, agg[m].total)])),
  }))
  .sort((a, b) => a.lines - b.lines);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const total = summary.total;
console.log("| module | lines | statements | functions | branches |");
console.log("| --- | --- | --- | --- | --- |");
for (const r of rows) {
  console.log(`| ${r.dir} | ${r.lines} | ${r.statements} | ${r.functions} | ${r.branches} |`);
}
console.log(
  `| **total** | ${total.lines.pct} | ${total.statements.pct} | ${total.functions.pct} | ${total.branches.pct} |`
);
