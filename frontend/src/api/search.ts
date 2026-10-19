// 全局搜索（P5-2，Cmd+K）：一次请求返回五类实体，tab 客户端过滤。
// 深链接契约：kb/doc → /knowledge-base/{id}；conv → /chat?kb=&conv=；
// task → /agent?task=；setting → settings.href（服务端给定）。
import { api } from "./client";

export interface SearchResults {
  kbs: { id: string; name: string; desc: string; ownerName: string; shared: boolean; updatedAt: number }[];
  docs: { id: string; kbId: string; kbName: string; name: string; type: string; status: string; url?: string; uploadedAt: number }[];
  conversations: { id: string; kbId: string; title: string; shared?: boolean; updatedAt: number }[];
  tasks: { id: string; topic: string; kbName?: string; status: string; updatedAt: number }[];
  settings: { id: string; label: string; href: string }[];
}

export type TabKey = "all" | "kbs" | "docs" | "conversations" | "tasks" | "settings";

export async function search(q: string, signal?: AbortSignal): Promise<SearchResults | null> {
  const d = await api.get<{ results?: SearchResults }>(
    `/api/search?q=${encodeURIComponent(q)}`,
    { signal }
  );
  return d?.results ?? null;
}

const RECENT_KEY = "kai-recent-search";
const RECENT_MAX = 8;

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearches(terms: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(terms.slice(0, RECENT_MAX)));
  } catch {
    /* quota / private mode */
  }
}
