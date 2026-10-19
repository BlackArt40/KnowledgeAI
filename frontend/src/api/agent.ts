// Agent 调研 API（V4）。运行流 POST /api/agent/run 的 SSE（事件名
// init/step/done/error/end 冻结）在视图内用 @shared/sse 消费。类型单源
// 复用 Next 侧 src/lib/agent/types（纯 TS，@shared 直引）。
import { request } from "./client";
import type { AgentTask } from "@shared/agent/types";

export type {
  AgentTask,
  AgentStep,
  AgentCitation,
  AgentRole,
  StepStatus,
  TaskStatus,
  OutputFormat,
  DagNode,
  DagEdge,
  ReportVersion,
  Comment,
  ShareConfig,
  ExportFormat,
} from "@shared/agent/types";

export async function fetchAgentTasks(): Promise<AgentTask[]> {
  const d = await request<{ tasks?: AgentTask[] }>("/api/agent/tasks");
  return d?.tasks ?? [];
}

/** 任务详情；404/无权时抛 ApiError，由调用方决定兜底。 */
export async function fetchAgentTask(id: string): Promise<AgentTask | null> {
  const d = await request<{ task?: AgentTask }>(`/api/agent/tasks/${encodeURIComponent(id)}`);
  return d?.task ?? null;
}

export function deleteAgentTask(id: string): Promise<unknown> {
  return request(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** PUT 手工编辑报告正文（P2-3 报告增强）。 */
export function saveAgentReport(id: string, report: string): Promise<{ task?: AgentTask }> {
  return request(`/api/agent/tasks/${encodeURIComponent(id)}/report`, { method: "PUT", body: { report } });
}

/** POST 恢复历史版本。 */
export function restoreAgentVersion(taskId: string, versionId: string): Promise<unknown> {
  return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/versions/${encodeURIComponent(versionId)}`, {
    method: "POST",
  });
}

/** PUT 分享配置（enabled/expiresAt/password/maxViews）。 */
export function putAgentShare(
  taskId: string,
  body: { enabled: boolean; expiresAt?: number | null; password?: string | null; maxViews?: number | null }
): Promise<{ shareConfig?: import("@shared/agent/types").ShareConfig | null }> {
  return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/share`, { method: "PUT", body });
}

export interface AgentComment {
  id: string;
  userId?: string;
  userName: string;
  text: string;
  citeN?: number;
  parentId?: string;
  createdAt: number;
}

export function fetchAgentComments(taskId: string): Promise<AgentComment[]> {
  return request<{ comments?: AgentComment[] }>(`/api/agent/tasks/${encodeURIComponent(taskId)}/comments`).then(
    (d) => d?.comments ?? []
  );
}

export function postAgentComment(
  taskId: string,
  body: { text: string; citeN?: number; parentId?: string }
): Promise<unknown> {
  return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/comments`, { method: "POST", body });
}

export function deleteAgentComment(taskId: string, commentId: string): Promise<unknown> {
  return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });
}
