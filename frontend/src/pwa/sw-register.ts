// P5-1 → V6：service worker 注册随页面层迁移到 Vue（原 src/components/pwa/
// sw-register.tsx 已随 Next 页面层退役）。仅在生产构建注册——dev 下缓存会
// 与 Vite HMR 抢新产物。public/sw.js 由网关兜底的 Next 静态目录同源服务。
import { clientLog } from "@shared/obs/log-browser";

export function registerSw(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js")
    .catch((err: unknown) => {
      // Non-fatal: the app works without offline support.
      clientLog.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[PWA] service worker registration failed"
      );
    });
}
