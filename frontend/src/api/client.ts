// 统一 API 客户端：默认同源 /api（网关反代，Cookie 自动携带），跨域部署用
// VITE_API_BASE 覆盖。401 一律跳 /login（仅 401；网络失败保留界面，与
// AppShell 离线策略对齐）——豁免清单：认证接口（登录页自管错误）、
// 公开分享接口（分享令牌/密码本身就是凭据，401=密码错误而非未登录）。
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/** 拼出绝对 URL（长连接订阅走 fetch，需要和 request() 一致的 base）。 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

const PUBLIC_401_PREFIXES = ["/api/auth/", "/api/share/", "/api/agent/public/"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string,
    readonly body?: unknown
  ) {
    super(message ?? `API ${status}`);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  // FormData（multipart 上传）不能手设 Content-Type——浏览器需自动生成
  // 带 boundary 的头；仅 JSON body 才显式声明。
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    credentials: "include",
    signal: opts.signal,
  });

  if (res.status === 401 && !PUBLIC_401_PREFIXES.some((p) => path.startsWith(p))) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, undefined, "未登录");
  }

  // 非 JSON 响应（204/网关错误页）按 null 处理，让状态码说话
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null;
    throw new ApiError(res.status, err?.code, err?.error, data);
  }
  return data as T;
}

/** Streaming (SSE) request: same base URL / credentials / 401 handling as
 *  request(), but returns the raw Response for consumeSseStream(). */
export async function streamRequest(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, undefined, "未登录");
  }
  return res;
}

export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  del: <T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};
