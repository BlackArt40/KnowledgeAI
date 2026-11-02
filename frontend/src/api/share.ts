// 公开分享 API（P4-2 文档分享 + Agent 报告分享；令牌/密码即凭据，无需登录）。
// 错误码契约（冻结）：needPassword(401) / expired(410) / exhausted(403) / notFound(404)。
import { api } from "./client";

export interface SharedDoc {
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  content: string;
  expiresAt: number | null;
  views: number;
  maxViews: number | null;
}

export type ShareErrorCode = "needPassword" | "expired" | "exhausted" | "notFound";

export async function fetchSharedDoc(token: string, password?: string): Promise<SharedDoc> {
  // 密码走请求头：query 会进入访问日志 / Referer / 浏览器历史。
  const headers = password !== undefined ? { "x-share-password": password } : undefined;
  return api.get<SharedDoc>(`/api/share/doc/${encodeURIComponent(token)}`, headers ? { headers } : {});
}

/** 知识库公开分享（共享与分发）：整库只读，文档级 private 不出现。 */
export interface SharedKbDoc {
  id: string;
  name: string;
  type: string;
  size: number;
  status: string;
  chunks: number;
  uploadedAt: number;
  snippet: string;
}

export interface SharedKb {
  kb: {
    id: string;
    name: string;
    desc: string;
    color: string;
    initial: string;
  };
  docs: SharedKbDoc[];
  /** 仅 ?doc=<id> 请求返回：单篇文档正文预览（前 3000 字符）。 */
  doc?: {
    id: string;
    name: string;
    type: string;
    size: number;
    uploadedAt: number;
    chunks: number;
    content: string;
  };
  expiresAt: number | null;
  views: number;
  maxViews: number | null;
}

/** 公开读取共享知识库；previewDocId 只取单篇正文（不计访问次数）。 */
export async function fetchSharedKb(
  token: string,
  password?: string,
  previewDocId?: string
): Promise<SharedKb> {
  const qs = previewDocId ? `?doc=${encodeURIComponent(previewDocId)}` : "";
  const headers = password !== undefined ? { "x-share-password": password } : undefined;
  return api.get<SharedKb>(`/api/share/kb/${encodeURIComponent(token)}${qs}`, headers ? { headers } : {});
}

export interface SharedReport {
  topic: string;
  report: string;
  citations: { n: number; title: string; snippet: string; source: string; score: number }[];
  comments?: {
    id: string;
    userName?: string;
    text: string;
    createdAt: number;
    parentId?: string;
    citeN?: number;
  }[];
  outputFormat: string;
  durationMs?: number;
  createdAt: number;
  protected?: boolean;
  views?: number;
}

/** Agent 报告公开读取；密码经 x-share-password 头传递（不是 query）。 */
export async function fetchSharedReport(id: string, password?: string): Promise<SharedReport> {
  const headers = password !== undefined ? { "x-share-password": password } : undefined;
  return api.get<SharedReport>(`/api/agent/public/${encodeURIComponent(id)}`, { headers });
}
