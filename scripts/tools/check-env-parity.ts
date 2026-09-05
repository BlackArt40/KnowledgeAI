/**
 * check-env-parity — CI 文档门禁：校验 .env.example 与 docs/ops/env-vars.md 的变量名集合一致。
 *
 * 用法：npx tsx scripts/tools/check-env-parity.ts
 *
 * 规则：
 *   - .env.example：取 `NAME=...` 变量名；行首 `#` 的注释示例行（`# NAME=`）
 *     也计入——它们是有意注释掉的可选配置，文档同样会记录。
 *   - env-vars.md：仅从变量表格行（`|` 开头）提取 `VAR_NAME` 形式的反引号
 *     变量名（大写字母开头，仅含 A-Z/0-9/下划线）——同一单元格内的
 *     `A / B` 会被分别提取；表格外的正文提及（如废弃说明）不计入。
 *   - 双向差集非空 → 退出码 1（CI 失败）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_EXAMPLE = resolve(process.cwd(), ".env.example");
const ENV_DOC = resolve(process.cwd(), "docs/ops/env-vars.md");

const VAR_RE = /^[A-Z][A-Z0-9_]+$/;

function envExampleVars(): Set<string> {
  const out = new Set<string>();
  for (const line of readFileSync(ENV_EXAMPLE, "utf-8").split(/\r?\n/)) {
    // 未注释的 `NAME=` 直接计入；`# NAME=` 的注释示例行同样计入（有意
    // 注释掉的可选配置，文档会以"仅 xxx 时使用"记录）。
    const candidate = line.trim().replace(/^#+\s*/, "");
    const eq = candidate.indexOf("=");
    if (eq === -1) continue;
    const name = candidate.slice(0, eq).trim();
    if (VAR_RE.test(name)) out.add(name);
  }
  return out;
}

function docVars(): Set<string> {
  const out = new Set<string>();
  const content = readFileSync(ENV_DOC, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue; // 仅变量表格行
    for (const m of line.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) out.add(m[1]);
  }
  return out;
}

const env = envExampleVars();
const doc = docVars();
const missingInDoc = [...env].filter((v) => !doc.has(v)).sort();
const missingInEnv = [...doc].filter((v) => !env.has(v)).sort();

if (missingInDoc.length > 0 || missingInEnv.length > 0) {
  console.error(`[env-parity] ✗ .env.example 与 docs/ops/env-vars.md 变量名集合不一致：`);
  for (const v of missingInDoc) console.error(`  - ${v}: 在 .env.example 中，文档缺失`);
  for (const v of missingInEnv) console.error(`  - ${v}: 在文档中，.env.example 缺失（已废弃？请两处同步移除）`);
  process.exit(1);
}
console.log(`[env-parity] ✓ ${env.size} 个环境变量在 .env.example 与 docs/ops/env-vars.md 完全一致`);
