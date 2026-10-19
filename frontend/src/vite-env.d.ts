/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 前缀：默认空 = 同源 /api（经网关反代）；跨域部署时填网关完整地址 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
