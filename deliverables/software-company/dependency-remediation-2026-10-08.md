# 依赖漏洞治理记录（Dependency Audit Remediation）

**日期**：2026-10-08
**触发**：上线体检残留项「依赖 CVE 未审计（无 `pnpm audit`）→ 在 CI 内补充（失败不阻断或按档）」的处置。

**基线数据**（修复前，`pnpm audit`）：

- 全量 **59** 个（3 critical / 30 high / 19 moderate / 7 low）
- 生产依赖 **35** 个（3 critical / 16 high / 12 moderate / 4 low）

## 修复动作

| 动作 | 内容 |
|------|------|
| 框架升级 | `next` 16.2.11 → **16.4.0**，`eslint-config-next` 同步（清 3×critical RCE/CVE + Image Optimization SSRF 等共 8 条 next 相关） |
| 生产链 overrides（`pnpm-workspace.yaml`，同线补丁级） | `@xmldom/xmldom ^0.8.15`、`sharp ^0.35.5`、`source-map-js ^1.2.2`、`browserslist ^4.29.3`、`baseline-browser-mapping ^2.11.27`、`undici ^7.29.1` |
| dev 链 overrides | `vite 6.4.4`、`js-yaml 4.3.2`、`brace-expansion 1.1.21 / 5.0.12`、`dompurify 3.4.16`、**`vue → 3.5.43`**（必须整族对齐 @vue/*：单独覆盖 `@vue/server-renderer` 会造成 vue 3.5.41 与 renderer 3.5.43 错配，vitepress SSR 出现 226 处 `data not properly injected` 报错——已实测复现并规避） |
| 常规更新 | `vitest` / `@vitest/coverage-v8` 4.1.10 → **4.1.11**（^ 范围更新） |

## 结果（修复后）

- 全量 **59 → 3**（−95%）；生产 **35 → 1**（−97%）
- **critical 清零；生产 high 清零**

### 残留（待上游发布 / 已评估豁免）

| 漏洞 | 严重度 | 依赖链 | 说明 |
|------|:------:|--------|------|
| `braces <=3.0.3` | high（dev） | `eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces` | 修复版 `3.0.4` 尚未发布（registry 最高 3.0.3） |
| `sprintf-js <=1.1.3` | moderate（prod） | `mammoth>argparse>sprintf-js` | 修复版 `1.1.4` 尚未发布 |
| `katex <0.18.2` | low（dev） | `mermaid>katex` | 修复需跨 minor（mermaid 声明 `^0.16.45`），有渲染回归风险；待 mermaid 升级后随之解决 |

## CI 集成

`quality` job 新增步骤：**`pnpm audit --audit-level=critical`** —— critical 阻断构建，high 及以下仅报告（当前退出码 0，已实测）。

## 验证矩阵（全绿）

- `tsc --noEmit` / `eslint`（零警告）/ `vitest`（60 文件 / 440 用例）
- `next build`（16.4.0，13/13 静态页 + standalone）
- `docs:build`（vitepress；无 SSR 报错）

## 顺带修复（升级引入的 lint 规则）

`eslint-config-next` 16.4.0 的新规则 `@next/next/no-location-assign-relative-destination` 报出 4 处会话边界导航：

- `src/lib/auth/oauth-signin.ts`（3 处 OAuth 失败回跳）
- `src/app/(app)/settings/page.tsx`（账号删除后跳登录）

均为"full navigation + 不留历史记录"的语义，已改为 `location.replace()`（符合规则意图的标准表达），lint 恢复零警告。

---

> 生成：2026-10-08 · 与 CI `quality` job 的 audit 步骤互为对照；更新残留清单时请同步本文件。
