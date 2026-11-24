export type SwaggerBundleLike = {
  presets: { apis: unknown };
  plugins: { DownloadUrl: unknown };
};

export function buildSwaggerUiConfig({
  specUrl,
  domNode,
  swaggerBundle,
  standalonePreset,
}: {
  specUrl: string;
  domNode: HTMLElement;
  swaggerBundle: SwaggerBundleLike;
  standalonePreset: unknown;
}) {
  return {
    url: specUrl,
    domNode,
    deepLinking: true,
    presets: [swaggerBundle.presets.apis, standalonePreset],
    plugins: [swaggerBundle.plugins.DownloadUrl],
    layout: "StandaloneLayout",
    persistAuthorization: true,
    displayRequestDuration: true,
  };
}
