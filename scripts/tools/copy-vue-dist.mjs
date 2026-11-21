#!/usr/bin/env node
// 单镜像部署：把 Vue 构建产物并入 Next 的 public/，由 Next 同时服务
// 页面与 /api。生成物已在 .gitignore 中，不提交。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "frontend", "dist");
const publicDir = join(root, "public");

if (!existsSync(join(dist, "index.html"))) {
  console.error("[copy-vue-dist] frontend/dist/index.html 不存在，先运行 pnpm -C frontend build");
  process.exit(1);
}

// 只复制运行时页面资产；vendor/widget 由根 public 单源提供，不在 dist 内。
const entries = [
  "index.html",
  "home.html",
  "assets",
  "sw.js",
  "sw-config.json",
  "manifest.webmanifest",
  "icons",
];

for (const entry of entries) {
  const from = join(dist, entry);
  if (!existsSync(from)) continue;
  const to = join(publicDir, entry);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(entry.includes(".") ? publicDir : to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

console.log(`[copy-vue-dist] copied ${entries.join(", ")} -> public/`);
