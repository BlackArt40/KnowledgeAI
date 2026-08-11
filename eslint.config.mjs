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
  ]),
  // Manual smoke scripts + seed use @ts-nocheck (per AGENTS.md convention).
  // These are standalone tsx scripts, not app code, so relax type-strictness rules.
  {
    files: ["scripts/**/*.ts", "scripts/**/*.tsx", "prisma/seed.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
