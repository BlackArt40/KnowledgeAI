import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 生成物 / 工具目录（P6-3: .claude worktrees 内含构建产物，曾导致 lint 误扫数万行）
    ".claude/**",
    ".zcode/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".playwright/**",
    // P7-1: vendored swagger-ui assets (minified third-party bundle copied
    // from node_modules by scripts/tools/copy-swagger-ui.mjs)
    "public/vendor/**",
    // P7-2: standalone integration products (VS Code extension uses CommonJS
    // require - VS Code host API; Chrome extension + widget are plain JS).
    "integrations/**",
    // P0-7: vitepress build artifacts (generated .vue files) - local `pnpm
    // lint` used to fail with 1000+ errors from this dir on a clean checkout.
    ".vitepress/**",
  ]),
  // Unused-vars policy: keep the warn level but exempt the repo's `_`-prefix
  // convention (e.g. `_redisUrl` params kept for API stability) and
  // rest-sibling field stripping (`const { tokenHash: _t, ...rest } = bot`).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Manual smoke scripts + seed use @ts-nocheck (per AGENTS.md convention).
  // These are standalone tsx/node scripts, not app code, so relax
  // type-strictness rules. (*.mjs smoke suites get the same relaxation as
  // their .ts siblings - they are equally standalone, run only by hand.)
  {
    files: ["scripts/**/*.ts", "scripts/**/*.tsx", "scripts/**/*.mjs", "prisma/seed.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
