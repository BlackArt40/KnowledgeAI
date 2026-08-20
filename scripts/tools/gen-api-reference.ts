/**
 * docs-openapi-gen — 从 OpenAPI 规范自动生成 API 参考文档。
 *
 * 用法：npx tsx scripts/tools/gen-api-reference.ts
 *
 * 数据源：src/lib/openapi/spec.ts（v1 API 的单一事实源）。
 * 产物：docs/api/reference.md（禁止手写，API 变更后重跑本脚本）。
 *
 * 确定性约束：产物必须与运行日期无关（CI 漂移检查依赖 git diff），
 * 因此 frontmatter 的 reviewed_at 与修订记录日期使用固定初始值，
 * 后续由人工复审时更新。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { OPENAPI_SPEC } from "../../src/lib/openapi/spec";

const OUT = resolve(process.cwd(), "docs/api/reference.md");
// 固定初始日期（首次生成日），保持产物确定性；人工复审时更新。
const INIT_DATE = "2026-08-20";

interface Op {
  method: string;
  summary: string;
  description: string;
  scope?: string;
  security: boolean;
  success: string[];
  errors: string[];
  eventStream?: boolean;
}

function extract(pathItem: Record<string, any>): Op[] {
  const ops: Op[] = [];
  for (const method of ["get", "post", "patch", "put", "delete"] as const) {
    const op = pathItem?.[method];
    if (!op) continue;
    const sec = op.security ?? [];
    const success = Object.keys(op.responses ?? {}).filter((c) => c.startsWith("2"));
    const errors = Object.keys(op.responses ?? {}).filter((c) => !c.startsWith("2"));
    const desc = String(op.description ?? "");
    const scopeMatch = desc.match(/scope:\s*([\w:]+)/);
    ops.push({
      method: method.toUpperCase(),
      summary: String(op.summary ?? ""),
      description: desc.replace(/\s+/g, " ").trim(),
      scope: scopeMatch?.[1],
      security: sec.length > 0,
      success,
      errors,
      eventStream: desc.includes("text/event-stream") || desc.includes("SSE"),
    });
  }
  return ops;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function build(): string {
  const paths = OPENAPI_SPEC.paths;
  const tags: Record<string, { path: string; ops: Op[] }[]> = {};
  for (const [path, item] of Object.entries(paths)) {
    for (const op of extract(item as Record<string, any>)) {
      const tag = (item as any).get?.tags?.[0] ?? (item as any).post?.tags?.[0] ?? "Other";
      (tags[tag] ??= []).push({ path, ops: [op] });
    }
  }

  const lines: string[] = [];
  lines.push(`---
title: API 参考
description: KnowledgeAI v1 公开 API 端点总表，由 OpenAPI 3.0.3 规范自动生成，禁止手写
type: reference
category: api
level: L2
version: 1.0.0
authors: [openapi-gen]
owner: api-owner
reviewed_at: ${INIT_DATE}
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, errors.md, webhooks.md]
---

# API 参考

> **自动生成文档**：本文由 \`scripts/tools/gen-api-reference.ts\` 从 [OpenAPI 3.0.3 规范](../../src/lib/openapi/spec.ts)生成（首次生成 2026-08-20，复审更新 reviewed_at）。**禁止手写修改正文**；API 变更后运行 \`npx tsx scripts/tools/gen-api-reference.ts\` 重新生成。
>
> 交互式文档：启动服务后访问 \`/docs\`（Swagger UI）；原始规范：\`GET /api/openapi.json\`。
> 使用指南（鉴权 / 限流 / 错误处理 / 调用示例）见 [API 使用指南](guide.md)。

## 端点总表（${Object.keys(paths).length} 组，均为 \`/api/v1\` 前缀下的公开表面）

| 方法 | 路径 | 摘要 | 鉴权 | Scope | 流式 |
|------|------|------|------|-------|------|
`);

  for (const [tag, groups] of Object.entries(tags)) {
    lines.push(`### ${tag}`);
    lines.push("");
    lines.push("| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |");
    lines.push("|------|------|------|-------|------|------|");
    for (const g of groups) {
      for (const op of g.ops) {
        const path = g.path;
        lines.push(
          `| \`${op.method}\` | \`${path}\` | ${esc(op.summary)} | ${op.scope ? "`" + op.scope + "`" : "—"} | ${op.success.join(" / ") || "—"} | ${op.errors.join(" / ") || "—"} |`
        );
      }
    }
    lines.push("");
  }

  lines.push(`## 认证方式

所有端点要求 \`Authorization: Bearer <API_KEY>\`（API Key，前缀 \`kai_sk_\`）或登录会话 JWT。API Key 按 scope 强制校验，缺少所需 scope 返回 403。详见 [API 使用指南 → 鉴权](guide.md#鉴权)。

## 数据模型

| Schema | 说明 |
|--------|------|
${Object.keys(OPENAI_SCHEMAS()).map((s) => `| \`${s}\` | 见 \`/api/openapi.json\` 中 \`#/components/schemas/${s}\` |`).join("\n")}

> 完整字段定义以 OpenAPI 规范为准（\`GET /api/openapi.json\` 或 \`/docs\` Swagger UI）。

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | ${INIT_DATE} | 由 OpenAPI 规范自动生成 |
`);

  return lines.join("\n");
}

function OPENAI_SCHEMAS() {
  return (OPENAPI_SPEC as any).components?.schemas ?? {};
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, build(), "utf-8");
console.log(`[gen-api-reference] wrote ${OUT}`);
