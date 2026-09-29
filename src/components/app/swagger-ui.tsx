"use client";

// Interactive API docs shell (P7-1): loads swagger-ui-dist assets from
// /vendor/swagger-ui (copied from node_modules by scripts/tools/copy-swagger-ui.mjs
// at postinstall/build time) and boots Swagger UI against /api/openapi.json.
// Zero React dependency from the swagger side - it renders into a raw div.

import { useEffect, useRef } from "react";
import { buildSwaggerUiConfig } from "@/lib/openapi/swagger-config";

declare global {
  interface Window {
    SwaggerUIBundle?: ((opts: Record<string, unknown>) => unknown) & {
      presets: { apis: unknown };
      plugins: { DownloadUrl: unknown };
    };
    SwaggerUIStandalonePreset?: unknown;
  }
}

export function SwaggerUI({ specUrl }: { specUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled || !ref.current || !window.SwaggerUIBundle) return;
      window.SwaggerUIBundle(
        buildSwaggerUiConfig({
          specUrl,
          domNode: ref.current,
          swaggerBundle: window.SwaggerUIBundle,
          standalonePreset: window.SwaggerUIStandalonePreset,
        })
      );
    };

    // Stylesheet (idempotent).
    if (!document.querySelector('link[href="/vendor/swagger-ui/swagger-ui.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/vendor/swagger-ui/swagger-ui.css";
      document.head.appendChild(link);
    }

    if (window.SwaggerUIBundle) {
      boot();
      return;
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
  }, [specUrl]);

  return <div ref={ref} id="kai-swagger-ui" className="min-h-[70vh] w-full" />;
}
