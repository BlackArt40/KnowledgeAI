// Swagger UI 装载器（V5，复刻 src/components/app/swagger-ui.tsx）：从
// /vendor/swagger-ui（postinstall 由 scripts/tools/copy-swagger-ui.mjs 拷贝到
// Next public/；生产经网关 location / 兜底命中 Next 静态目录，开发经 vite
// proxy ^/vendor/ 转发）加载 bundle，再以 @shared/openapi/swagger-config 的
// 同一配置渲染 /api/openapi.json。swagger 侧零框架依赖——渲染进裸 div。
import { buildSwaggerUiConfig } from "@shared/openapi/swagger-config";

declare global {
  interface Window {
    SwaggerUIBundle?: ((opts: Record<string, unknown>) => unknown) & {
      presets: { apis: unknown };
      plugins: { DownloadUrl: unknown };
    };
    SwaggerUIStandalonePreset?: unknown;
  }
}

export function mountSwaggerUi(el: HTMLElement, specUrl: string): () => void {
  let cancelled = false;

  const boot = () => {
    if (cancelled || !el || !window.SwaggerUIBundle) return;
    window.SwaggerUIBundle(
      buildSwaggerUiConfig({
        specUrl,
        domNode: el,
        swaggerBundle: window.SwaggerUIBundle,
        standalonePreset: window.SwaggerUIStandalonePreset,
      })
    );
  };

  if (!document.querySelector('link[href="/vendor/swagger-ui/swagger-ui.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/vendor/swagger-ui/swagger-ui.css";
    document.head.appendChild(link);
  }

  if (window.SwaggerUIBundle) {
    boot();
    return () => {
      cancelled = true;
    };
  }

  const bundle = document.createElement("script");
  bundle.src = "/vendor/swagger-ui/swagger-ui-bundle.js";
  bundle.onload = () => {
    const preset = document.createElement("script");
    preset.src = "/vendor/swagger-ui/swagger-ui-standalone-preset.js";
    preset.onload = boot;
    document.head.appendChild(preset);
  };
  document.head.appendChild(bundle);

  return () => {
    cancelled = true;
  };
}
