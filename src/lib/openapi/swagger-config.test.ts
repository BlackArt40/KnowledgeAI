import { describe, expect, it } from "vitest";
import { buildSwaggerUiConfig } from "./swagger-config";

describe("Swagger UI homepage config", () => {
  it("keeps the built-in API preset and download plugin required for spec loading", () => {
    const apisPreset = { id: "apis" };
    const downloadPlugin = { id: "download" };
    const standalonePreset = { id: "standalone" };
    const domNode = {} as HTMLElement;

    const config = buildSwaggerUiConfig({
      specUrl: "/api/openapi.json",
      domNode,
      swaggerBundle: {
        presets: { apis: apisPreset },
        plugins: { DownloadUrl: downloadPlugin },
      },
      standalonePreset,
    });

    expect(config.presets).toEqual([apisPreset, standalonePreset]);
    expect(config.plugins).toEqual([downloadPlugin]);
    expect(config.url).toBe("/api/openapi.json");
    expect(config.domNode).toBe(domNode);
  });
});
