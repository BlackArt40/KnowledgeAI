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
  const qs = password ? `?password=${encodeURIComponent(password)}` : "";
  return api.get<SharedDoc>(`/api/share/doc/${encodeURIComponent(token)}${qs}`);
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
