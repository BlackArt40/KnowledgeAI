// 知识库 API（V3，契约与 /api/knowledge-base* 冻结一致）。
import { request } from "./client";

export interface KbStats {
  total: number;
  ready: number;
  processing: number;
  chunks: number;
  size?: number;
}

export interface Kb {
  id: string;
  name: string;
  desc: string;
  color?: string;
  initial?: string;
  ownerId: string;
  workspaceId?: string;
  createdAt: number;
  [key: string]: unknown;
}

export interface KbListItem extends Kb {
  shared: boolean;
  ownerName: string;
  stats: KbStats;
}

export interface KbDoc {
  id: string;
  name: string;
  type: string;
  status: string;
  chunks: number;
  size: number;
  uploadedAt: number;
  error?: string;
  access?: string | null;
  [key: string]: unknown;
}

export async function fetchKbs(): Promise<KbListItem[]> {
  const d = await request<{ kbs?: KbListItem[] }>("/api/knowledge-base");
  return d?.kbs ?? [];
}

export async function createKb(body: { name: string; desc?: string; color?: string; initial?: string }): Promise<Kb> {
  const d = await request<{ kb: Kb }>("/api/knowledge-base", { method: "POST", body });
  return d.kb;
}

export interface KbDetail {
  kb: Kb;
  docs: KbDoc[];
  stats: KbStats;
}

export async function fetchKbDetail(id: string): Promise<KbDetail> {
  return request<KbDetail>(`/api/knowledge-base/${encodeURIComponent(id)}`);
}

export function patchKb(id: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/knowledge-base/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteKb(id: string): Promise<unknown> {
  return request(`/api/knowledge-base/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** multipart 上传（字段名 files）→ { docs, errors }，201 = 已入队解析。 */
export async function uploadDocs(
  id: string,
  files: File[]
): Promise<{ docs: KbDoc[]; errors: string[] }> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return request(`/api/knowledge-base/${encodeURIComponent(id)}/upload`, {
    method: "POST",
    body: fd,
  });
}

export function deleteDoc(kbId: string, docId: string): Promise<unknown> {
  return request(`/api/knowledge-base/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
  });
}

/** 重建单篇文档索引（正文已在库里，仅重跑切片 + 嵌入）。 */
export function reindexDoc(kbId: string, docId: string): Promise<{ doc?: KbDoc; queued?: boolean }> {
  return request(
    `/api/knowledge-base/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/reindex`,
    { method: "POST" }
  );
}

/** 整库重建索引：逐篇复位并入队，返回 queued/skipped/failed。 */
export function reindexKb(kbId: string): Promise<{ queued: number; skipped: number; failed: number; total: number }> {
  return request(`/api/knowledge-base/${encodeURIComponent(kbId)}/reindex`, { method: "POST" });
}

export function patchDoc(kbId: string, docId: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/knowledge-base/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`, {
    method: "PATCH",
    body,
  });
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  mentions: number;
  docCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
}

export async function fetchGraph(kbId: string): Promise<{ kb: { id: string; name: string }; nodes: GraphNode[]; edges: GraphEdge[] }> {
  return request(`/api/knowledge-base/${encodeURIComponent(kbId)}/graph`);
}
