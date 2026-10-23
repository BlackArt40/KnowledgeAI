// 客户端错误上报（P6-1 在 Vue 侧的实现；Next 页面层的 error-reporter.tsx 已退役）。
//
// 三个来源统一进 `POST /api/obs/report`（服务端写入错误环 + SENTRY_DSN 门控转发，
// 匿名设计——错误是遥测数据，不是用户数据）：
//  - window `error`（脚本运行时错误）
//  - window `unhandledrejection`（未处理的 Promise 拒绝）
//  - Vue `app.config.errorHandler`（组件渲染/生命周期异常，见 main.ts）
//
// 同一 message 30s 内只报一次：接口在 proxy 的一般限流档位下，错误风暴（比如
// 渲染循环）很容易把用户自己的额度刷掉，客户端必须先自限流。
import { apiUrl } from "@/api/client";

const THROTTLE_MS = 30_000;
const reported = new Map<string, number>();

/** 上报一条客户端错误；被去重拦下时返回 false。 */
export function reportClientError(message: string, stack?: string, source = "vue"): boolean {
  const text = message.trim();
  if (!text) return false;
  const key = `${source}:${text}`;
  const now = Date.now();
  if (now - (reported.get(key) ?? 0) < THROTTLE_MS) return false;
  reported.set(key, now);

  void fetch(apiUrl("/api/obs/report"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({
      message: text.slice(0, 2000),
      stack: stack?.slice(0, 8000),
      source,
      url: typeof window !== "undefined" ? window.location.href : undefined,
    }),
  }).catch(() => {
    /* 遥测失败不影响用户 */
  });
  return true;
}

let installed = false;

/** 挂全局兜底监听（window error / unhandledrejection）。重复调用是幂等的。 */
export function installGlobalErrorReporter(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    const target = event.error instanceof Error ? event.error : null;
    reportClientError(target?.message ?? event.message ?? "unknown error", target?.stack, "window");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    const err = reason instanceof Error ? reason : null;
    reportClientError(err?.message ?? String(reason ?? "unhandled rejection"), err?.stack, "promise");
  });
}
