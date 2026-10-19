import { fileURLToPath } from "node:url";
import { cpSync, existsSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
// 共享资产单源：i18n 语言包 / SSE 解析 / 主题引擎都在 Next 侧 src/lib，
// 经 @shared 直接引用，禁止拷贝（design log 十五·二十七 的同步义务）。
const sharedLibDir = fileURLToPath(new URL("../src/lib", import.meta.url));
const distDir = fileURLToPath(new URL("./dist", import.meta.url));
// PWA 资产单源在根 public/（Next 静态目录——widget/swagger 等同源共享）：
// V6 后 preview/网关 Vue 流量也需 sw.js/manifest/icons，构建期仅拷贝 PWA
// 子集（不整目录拷——vendor swagger-ui 与 widget 体积大且经网关兜底可达）。
const rootPublicDir = fileURLToPath(new URL("../public", import.meta.url));
const PWA_ASSETS = ["sw.js", "sw-config.json", "manifest.webmanifest", "icons"];

function copyPwaAssets(): import("vite").Plugin {
  return {
    name: "copy-pwa-assets",
    apply: "build",
    closeBundle() {
      for (const asset of PWA_ASSETS) {
        const from = `${rootPublicDir}/${asset}`;
        if (existsSync(from)) cpSync(from, `${distDir}/${asset}`, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    copyPwaAssets(),
    vue(),
    // preview 服务器镜像生产网关的 location = / 行为（switch-frontend.sh：
    // try_files /home.html /index.html）——根路径优先返回 SEO 预渲染首页
    {
      name: "preview-home-fallback",
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/" || req.url?.startsWith("/?")) req.url = "/home.html";
          next();
        });
      },
    },
    AutoImport({
      imports: ["vue", "vue-router", "pinia"],
      resolvers: [ElementPlusResolver()],
      dts: fileURLToPath(new URL("./src/auto-imports.d.ts", import.meta.url)),
    }),
    Components({
      // 样式走 main.ts 的全量 theme-chalk import（importStyle:false 避免
      // 每组件样式注入与暗色变量顺序问题；包体优化留到退役阶段）。
      resolvers: [ElementPlusResolver({ importStyle: false })],
      dts: fileURLToPath(new URL("./src/components.d.ts", import.meta.url)),
    }),
  ],
  resolve: {
    alias: {
      "@": srcDir,
      "@shared": sharedLibDir,
    },
  },
  server: {
    port: 5173,
    // 本地开发：/api/*（含子路径）代理到 Next dev（单体模式，全部 API 可用），
    // 不经网关。必须用 ^/api/ 正则——字符串前缀 "/api" 会把 /api-keys 页面
    // 也代理到 Next（V3 实测踩坑：页面被 Next 同名页顶掉，Vue 视图不挂载）。
    // ^/vendor/ 同理代理到 Next public/（postinstall 拷贝的 swagger-ui-dist，
    // 单源不拷贝——/docs 页的静态资产生产走网关兜底，开发走此代理）。
    proxy: {
      "^/api/": "http://localhost:3000",
      "^/vendor/": "http://localhost:3000",
    },
  },
  // V6 退役后双 webServer 的页面承载端：vite preview 服务 dist（含 SEO 预
  // 渲染 home.html），/api 与 /vendor 反代 Next API（:3000）。根 e2e、
  // smoke ui 组、functional 页面检查统一打 :4173。
  preview: {
    port: 4173,
    proxy: {
      "^/api/": "http://localhost:3000",
      "^/vendor/": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
