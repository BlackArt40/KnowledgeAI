/**
 * check-docs-frontmatter — CI 文档门禁：校验 docs/ 下所有文档的 Frontmatter 完整性。
 *
 * 用法：npx tsx scripts/tools/check-docs-frontmatter.ts
 *
 * 规则（与 docs/standards/doc-writing-standards.md 保持一致）：
 *   - 必填字段：title / description / type / category / level / version /
 *     authors / owner / reviewed_at / review_interval / status
 *   - 值域：type ∈ tutorial|how-to|reference|explanation
 *           category ∈ getting-started|architecture|api|standards|ops|faq
 *           level ∈ L1|L2|L3；status ∈ draft|review|published|archived|deprecated
 *   - 格式：reviewed_at = YYYY-MM-DD；review_interval = 数字
 *   - 排除：superpowers/（L0 草稿）、archive/（已归档）
 *
 * 任何文档不满足 → 退出码 1（CI 失败）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const DOCS_ROOT = resolve(process.cwd(), "docs");
const EXCLUDED_DIRS = new Set(["superpowers", "archive", "screenshots", ".vitepress"]);

const REQUIRED = [
  "title", "description", "type", "category", "level", "version",
  "authors", "owner", "reviewed_at", "review_interval", "status",
] as const;

const TYPE_VALUES = new Set(["tutorial", "how-to", "reference", "explanation"]);
const CATEGORY_VALUES = new Set(["getting-started", "architecture", "api", "standards", "ops", "faq"]);
const LEVEL_VALUES = new Set(["L1", "L2", "L3"]);
const STATUS_VALUES = new Set(["draft", "review", "published", "archived", "deprecated"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 收集 docs/ 下所有 .md（排除草稿/归档目录）。 */
function collectMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (EXCLUDED_DIRS.has(name)) continue;
    if (statSync(full).isDirectory()) out.push(...collectMarkdown(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 解析简化的 YAML frontmatter（键值 + 字符串数组 + 数字），失败返回 null。 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const data: Record<string, unknown> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    const key = line.slice(0, idx).trim();
    // P0-7: narrow from the string raw value explicitly - `value` stays
    // `unknown` for the record but all string ops run on the const `raw`
    // (TS can't narrow a mutable `unknown` across branches).
    const raw = line.slice(idx + 1).trim();
    let value: unknown = raw;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      value = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^["'].*["']$/.test(raw)) {
      value = raw.slice(1, -1);
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      value = Number(raw);
    }
    data[key] = value;
  }
  return data;
}

function validate(file: string): string[] {
  const rel = relative(process.cwd(), file);
  const raw = readFileSync(file, "utf-8");
  const fm = parseFrontmatter(raw);
  const problems: string[] = [];
  if (!fm) {
    return [`${rel}: 缺少合法 Frontmatter（须以 --- 开头且闭合）`];
  }
  for (const field of REQUIRED) {
    if (fm[field] === undefined || fm[field] === "") problems.push(`${rel}: 缺少必填字段 "${field}"`);
  }
  if (fm.type && !TYPE_VALUES.has(fm.type as string)) problems.push(`${rel}: type "${fm.type}" 非法`);
  if (fm.category && !CATEGORY_VALUES.has(fm.category as string)) problems.push(`${rel}: category "${fm.category}" 非法`);
  if (fm.level && !LEVEL_VALUES.has(fm.level as string)) problems.push(`${rel}: level "${fm.level}" 非法`);
  if (fm.status && !STATUS_VALUES.has(fm.status as string)) problems.push(`${rel}: status "${fm.status}" 非法`);
  if (fm.reviewed_at && !DATE_RE.test(String(fm.reviewed_at))) problems.push(`${rel}: reviewed_at "${fm.reviewed_at}" 应为 YYYY-MM-DD`);
  if (fm.review_interval !== undefined && typeof fm.review_interval !== "number") {
    problems.push(`${rel}: review_interval 应为数字`);
  }
  if (fm.authors !== undefined && !Array.isArray(fm.authors)) {
    problems.push(`${rel}: authors 应为数组 [a, b]`);
  }
  return problems;
}

const files = collectMarkdown(DOCS_ROOT).sort();
const allProblems: string[] = [];
for (const f of files) allProblems.push(...validate(f));

if (allProblems.length > 0) {
  console.error(`[docs-frontmatter] ✗ ${allProblems.length} 个问题（共检查 ${files.length} 个文件）：`);
  for (const p of allProblems) console.error("  - " + p);
  process.exit(1);
}
console.log(`[docs-frontmatter] ✓ ${files.length} 个文档 Frontmatter 全部合法`);
