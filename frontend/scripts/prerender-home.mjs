// 构建期首页预渲染（V5，SEO 保线）：用 Vite SSR 构建（仅含 HomeView 的最小
// 应用）+ @vue/server-renderer renderToString，把营销首页的静态 HTML 注入
// dist/home.html。国内搜索引擎（百度等）不执行 JS——网关对 location = /
// 优先返回 home.html（try_files /home.html /index.html），浏览器端应用挂载
// 后正常接管交互（挂载即替换内容，无 hydration 约束）。
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..");
const distDir = join(root, "dist");

if (!existsSync(join(distDir, "index.html"))) {
  console.error("[prerender-home] dist/index.html 不存在——先执行 vite build");
  process.exit(1);
}

// 1) SSR 构建：入口只挂 HomeView（i18n 插件注入共享语言包单例）。
//    继承项目 vite.config.ts（获得 @/@shared alias 与 vue 插件），仅覆盖 build。
//    产物放 node_modules/.kai-prerender——SSR bundle 外部化 vue/i18next 等裸导入，
//    只有放进 node_modules 树内才能被 Node 的解析链找到（临时目录不行）。
const outDir = join(root, "node_modules/.kai-prerender");
rmSync(outDir, { recursive: true, force: true });
try {
  await build({
    root,
    // 继承项目 vite.config.ts（获得 @/@shared alias 与 vue 插件），仅覆盖 build
    configFile: resolve(root, "vite.config.ts"),
    logLevel: "warn",
    build: {
      ssr: resolve(root, "src/prerender/home-entry.ts"),
      outDir,
      rollupOptions: {
        output: { format: "esm", entryFileNames: "home-entry.mjs" },
      },
    },
  });

  // 2) 渲染
  const { renderHome } = await import(`file://${join(outDir, "home-entry.mjs")}`);
  const appHtml = await renderHome();

  // 3) 注入：以 dist/index.html 为模板，替换 <div id="app"></div> 的内容，
  //    并保留全部 script/link 标签（浏览器端应用照常启动并接管交互）
  const template = readFileSync(join(distDir, "index.html"), "utf8");
  const marker = '<div id="app"></div>';
  if (!template.includes(marker)) {
    console.error("[prerender-home] 模板中未找到 <div id=\"app\"></div>，跳过预渲染");
    process.exit(1);
  }
  writeFileSync(join(distDir, "home.html"), template.replace(marker, `<div id="app">${appHtml}</div>`));
  console.log("[prerender-home] dist/home.html 生成完成（SEO 静态首页）");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
