// ---------------------------------------------------------------------------
// Chat failure classification.
//
// Before this module every generation failure reached the client as the same
// frame: { type: "error", message: "生成回答时出错，请重试。" }. That is wrong
// for the cases operators actually act on — a provider whose balance ran out
// ("Sorry, your account balance is insufficient") or a rotated-out API key does
// not fix itself by retrying, and retrying makes the outage look like a
// transient blip in the UI.
//
// The AI SDK surfaces provider problems as `APICallError` (statusCode /
// responseBody) or wraps them in `AI_NoOutputGeneratedError` with the original
// error in `cause`, so classification walks the cause chain. Messages are fixed
// strings: raw provider bodies never reach the client (they can contain keys or
// account details).
// ---------------------------------------------------------------------------

export type ChatErrorCode = "upstream_quota" | "upstream_auth" | "upstream_timeout" | "empty_response" | "internal";

export interface ChatFailure {
  code: ChatErrorCode;
  /** Client-safe, already localized message. Retry guidance differs per code. */
  message: string;
  /** Provider HTTP status when one was found in the cause chain. */
  status?: number;
}

const MESSAGES: Record<ChatErrorCode, string> = {
  upstream_quota: "模型服务额度不足或调用频率超限，稍后重试；持续出现请联系管理员。",
  upstream_auth: "模型服务鉴权失败（密钥无效或已过期），请联系管理员。",
  upstream_timeout: "模型服务响应超时，请稍后重试。",
  empty_response: "模型未返回内容，请稍后重试；持续出现请检查模型服务配置。",
  internal: "生成回答时出错，请重试。",
};

const QUOTA_RE = /insufficient|quota|balance|rate.?limit|too many requests|余额|额度|配额/i;
const AUTH_RE = /unauthor|forbidden|invalid.?api.?key|authentication|鉴权|密钥/i;
const TIMEOUT_RE = /timeout|timed out|ETIMEDOUT|ECONNRESET|aborted?|超时/i;
const EMPTY_RE = /empty_response|未返回内容|no output generated/i;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  responseBody?: unknown;
  cause?: unknown;
}

/** Flatten an error (and up to 5 `cause` levels) into searchable text + status. */
function inspect(err: unknown): { status?: number; text: string } {
  let status: number | undefined;
  const parts: string[] = [];
  let cur: unknown = err;

  for (let depth = 0; depth < 6 && cur && typeof cur === "object"; depth += 1) {
    const e = cur as ErrorLike;
    for (const v of [e.statusCode, e.status]) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n) && !status) status = n;
    }
    for (const v of [e.name, e.message, e.code, e.responseBody]) {
      if (typeof v === "string") parts.push(v);
    }
    cur = e.cause;
  }
  if (parts.length === 0) parts.push(String(err));
  return { status, text: parts.join(" \n ") };
}

/**
 * Map a thrown generation error to a client-safe code + message.
 * Order matters: an authenticated quota error must read as quota, not auth.
 */
export function classifyChatError(err: unknown): ChatFailure {
  const { status, text } = inspect(err);

  if (status === 429 || status === 402 || QUOTA_RE.test(text)) {
    return { code: "upstream_quota", message: MESSAGES.upstream_quota, ...(status ? { status } : {}) };
  }
  // A client-side abort (tab closed / stop button) reaches this catch too; it is
  // not an upstream timeout and nobody is listening for the message.
  if (/AbortError/.test(text)) {
    return { code: "internal", message: MESSAGES.internal, ...(status ? { status } : {}) };
  }
  if (status === 401 || status === 403 || AUTH_RE.test(text)) {
    return { code: "upstream_auth", message: MESSAGES.upstream_auth, ...(status ? { status } : {}) };
  }
  if (EMPTY_RE.test(text)) {
    return { code: "empty_response", message: MESSAGES.empty_response, ...(status ? { status } : {}) };
  }
  if (TIMEOUT_RE.test(text)) {
    return { code: "upstream_timeout", message: MESSAGES.upstream_timeout, ...(status ? { status } : {}) };
  }
  return { code: "internal", message: MESSAGES.internal, ...(status ? { status } : {}) };
}
