// @ts-nocheck
// P5-4 acceptance: NO hard-coded Chinese UI strings remain in client-facing
// code. V6：Next 页面层已退役（src/app 只剩 /api），UI 扫描范围收缩为
// frontend/src（Vue 3 + EP，.vue 模板 + ts/tsx）。Skips:
//   - comments (// and /* */ and <!-- -->)
//   - the language packs themselves (src/lib/i18n/messages)
//   - server-side API error messages & lib prompts (out of UI scope)
//   - t("...") call sites (the key is English)
// Also asserts zh-CN.json and en.json share the same key tree (a missing en
// translation falls back to the key and would be visible in the UI).
// Run: npx tsx scripts/smoke/test-i18n-coverage.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src"); // 语言包仍单源在 src/lib（@shared 共享）
// V6：frontend/src 是唯一的客户端 UI 代码（Next 前端已退役）
const FRONTEND_ROOT = join(process.cwd(), "frontend/src");
const ZH = JSON.parse(readFileSync(join(ROOT, "lib/i18n/messages/zh-CN.json"), "utf8"));
const EN = JSON.parse(readFileSync(join(ROOT, "lib/i18n/messages/en.json"), "utf8"));

const CJK = /[\u4e00-\u9fff]/;

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) {
      if (p.includes("i18n/messages")) continue;
      if (p.includes("/api")) continue; // server API error messages are out of UI scope
      out.push(...collectTsxFiles(p));
    } else if (/\.(tsx|ts|vue)$/.test(name)) {
      // 单测断言里会出现语言包原值（如 expect(t("common.save")).toBe("保存")），
      // 不是 UI 字符串 —— 豁免
      if (/\.test\.(ts|tsx)$/.test(name)) continue;
      out.push(p);
    }
  }
  return out;
}

/** Strip comments so they never match. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, ""); // Vue SFC template comments
}

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") out.push(...collectKeys(v, key));
    else out.push(key);
  }
  return out;
}

async function main() {
  let failures = 0;
  const results: string[] = [];
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  };

  // ── 1. key tree parity ────────────────────────────────────────────────
  const zhKeys = collectKeys(ZH).sort();
  const enKeys = collectKeys(EN).sort();
  // Language names stay in their own language (common.chinese/english) - that
  // is intentional, so they are excluded from the parity check.
  const getVal = (obj: unknown, key: string): unknown =>
    key.split(".").reduce((o: unknown, p: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), obj);
  const missingEn = zhKeys.filter((k) => {
    const enVal = getVal(EN, k);
    return enVal === undefined || (enVal === getVal(ZH, k) && !["common.chinese", "common.english", "page.settings.s7"].includes(k));
  });
  check("i18n: every zh key has an en translation", missingEn.length === 0, `${missingEn.length}: ${missingEn.slice(0, 5).join(", ")}`);
  const orphanInEn = enKeys.filter((k) => getVal(ZH, k) === undefined);
  check("i18n: no orphan keys in en.json", orphanInEn.length === 0, `${orphanInEn.length}`);

  // ── 2. residual Chinese in UI code ────────────────────────────────────
  // V6：src/app 下已无页面层（只剩 /api，collectTsxFiles 本就跳过 /api）——
  // UI 扫描仅 frontend/src。
  const files = [...collectTsxFiles(FRONTEND_ROOT)];
  const offenders: string[] = [];
  let tCallSites = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // generateMetadata contains intentional dual-language metadata (SEO) -
    // skip its body.
    const metaStart = src.indexOf("generateMetadata");
    let clean = stripComments(src);
    if (metaStart !== -1) {
      const open = src.indexOf("{", metaStart);
      if (open !== -1) {
        let depth = 0;
        let end = open;
        for (let i = open; i < src.length; i++) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        clean = clean.slice(0, metaStart) + " ".repeat(end - metaStart) + clean.slice(end);
      }
    }
    // count t("...") call sites
    tCallSites += (clean.match(/t\("([^"]+)"\)/g) ?? []).length;
    // residual Chinese outside t() args. Quoted literals are checked on
    // every line: backtick segments are removed first, so a "..." literal
    // sitting next to a template expression is still inspected (the old
    // blanket skip of backtick lines hid labels like "月收入").
    for (const line of clean.split("\n")) {
      const noTemplates = line.replace(/`[^`]*`/g, "");
      for (const m of noTemplates.matchAll(/"([^"\n<>]*[\u4e00-\u9fff][^"\n<>]*)"/g)) {
        const lit = m[1];
        const before = noTemplates.slice(Math.max(0, m.index - 40), m.index);
        if (/t\($/.test(before.replace(/\s/g, ""))) continue;
        if (lit.length > 0 && /[\u4e00-\u9fff]/.test(lit)) {
          offenders.push(`${f}: "${lit.slice(0, 60)}"`);
        }
      }
      // JSX text nodes (any line)
      for (const m of line.matchAll(/>([^<>{}]{0,120}[\u4e00-\u9fff][^<>{}]{0,120})</g)) {
        const txt = m[1].trim();
        if (txt) offenders.push(`${f}: text> ${txt.slice(0, 60)}`);
      }
      // template literals with CJK
      for (const m of line.matchAll(/`([^`\n]*[\u4e00-\u9fff][^`\n]*)`/g)) {
        offenders.push(`${f}: tmpl> ${m[1].slice(0, 60)}`);
      }
      // raw CJK anywhere else on the line (strings/templates/comments
      // removed above). Catches multi-line JSX text nodes - text sitting on
      // its own line between tags - which the `>text<` same-line pattern
      // above cannot see, including `标签：{expr}` mixed nodes.
      const stripped = line
        .replace(/`[^`]*`/g, "")
        .replace(/"[^"]*"/g, "")
        .replace(/'[^']*'/g, "")
        .replace(/\/\/.*$/, "");
      if (/[\u4e00-\u9fff]/.test(stripped)) {
        offenders.push(`${f}: raw> ${stripped.trim().slice(0, 60)}`);
      }
    }
  }
  check(
    "i18n: no residual Chinese UI strings",
    offenders.length === 0,
    `\n  ${offenders.slice(0, 30).join("\n  ")}`
  );
  check("i18n: t() call sites exist (extraction happened)", tCallSites > 300, `${tCallSites}`);

  console.log(`\n${results.join("\n")}`);
  console.log(`\nI18n coverage: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
