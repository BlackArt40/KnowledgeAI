// 工作区（P4-3 多租户）：列表/创建/品牌色。切换 = 写 kai-workspace cookie（7 天）
// + 整页刷新（与 Next 版一致，所有 API 按新租户执行）。
import { api } from "./client";

export interface Workspace {
  id: string;
  name: string;
  plan: string;
  active: boolean;
  brandColor?: string;
  isOwner?: boolean;
}

export interface WorkspaceList {
  workspaces: Workspace[];
  currentWorkspace?: string;
  currentName?: string;
}

export function setWorkspaceCookie(id: string): void {
  document.cookie = `kai-workspace=${id}; path=/; max-age=604800`;
}

export function switchTo(id: string): void {
  setWorkspaceCookie(id);
  window.location.reload();
}

export async function fetchWorkspaces(): Promise<WorkspaceList> {
  return api.get<WorkspaceList>("/api/workspaces");
}

export async function createWorkspace(name: string): Promise<{ workspace?: { id: string } }> {
  return api.post("/api/workspaces", { name });
}

export async function saveBrandColor(brandColor: string): Promise<void> {
  await api.patch("/api/workspaces", { brandColor });
}
