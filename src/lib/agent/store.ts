import { createHash, randomUUID } from "crypto";
import type { AgentTask, ShareConfig, ReportVersion, Comment } from "./types";
import { persistTask } from "@/lib/db/persist";

type Store = { tasks: Map<string, AgentTask> };
const g = globalThis as unknown as { __KAI_AGENT_STORE__?: Store };
function store(): Store {
  if (!g.__KAI_AGENT_STORE__) g.__KAI_AGENT_STORE__ = { tasks: new Map() };
  return g.__KAI_AGENT_STORE__;
}

function uid() {
  return `task_${Math.random().toString(36).slice(2, 10)}`;
}

export function listTasks(userId?: string): AgentTask[] {
  const all = Array.from(store().tasks.values());
  const filtered = userId ? all.filter((t) => t.userId === userId) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTask(id: string): AgentTask | undefined {
  return store().tasks.get(id);
}

export function createTask(input: {
  topic: string;
  kbId?: string;
  kbName?: string;
  outputFormat: AgentTask["outputFormat"];
  agents: AgentTask["agents"];
  maxSteps: number;
  template?: string;
}, userId?: string): AgentTask {
  const now = Date.now();
  const task: AgentTask = {
    id: uid(),
    topic: input.topic,
    kbId: input.kbId,
    kbName: input.kbName,
    outputFormat: input.outputFormat,
    agents: input.agents,
    maxSteps: input.maxSteps,
    template: input.template,
    status: "queued",
    steps: [],
    citations: [],
    outline: [],
    createdAt: now,
    updatedAt: now,
    userId,
  };
  store().tasks.set(task.id, task);
  void persistTask(task);
  return task;
}

export function saveTask(task: AgentTask) {
  task.updatedAt = Date.now();
  store().tasks.set(task.id, task);
  void persistTask(task);
}

export function deleteTask(id: string): boolean {
  return store().tasks.delete(id);
}

/** Delete ALL tasks for a user (account deletion). */
export function deleteAllTasks(userId: string): number {
  const s = store();
  let count = 0;
  for (const [id, task] of s.tasks) {
    if (task.userId === userId) {
      s.tasks.delete(id);
      count++;
    }
  }
  return count;
}

// ── P2-3: Share link permissions (criterion #2) ──────────────────────────

/** SHA-256 hash a share password (no external deps). */
export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/** Verify a plaintext password against a stored hash. */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/** Patch shape for share config (null clears an optional field). */
export interface SharePatch {
  enabled?: boolean;
  expiresAt?: number | null;
  passwordHash?: string | null;
  maxViews?: number | null;
}

/** Update the share config for a task. */
export function setShareConfig(taskId: string, patch: SharePatch): ShareConfig | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  const cur: ShareConfig = task.shareConfig ?? { enabled: false, views: 0 };
  const next: ShareConfig = {
    enabled: patch.enabled ?? cur.enabled,
    expiresAt: cur.expiresAt,
    passwordHash: cur.passwordHash,
    maxViews: cur.maxViews,
    views: cur.views,
  };
  if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt === null ? undefined : patch.expiresAt;
  if (patch.passwordHash !== undefined) next.passwordHash = patch.passwordHash === null ? undefined : patch.passwordHash;
  if (patch.maxViews !== undefined) next.maxViews = patch.maxViews === null ? undefined : patch.maxViews;
  task.shareConfig = next;
  saveTask(task);
  return next;
}

/** Get the effective share config (or a default disabled one). */
export function getShareConfig(taskId: string): ShareConfig {
  const task = getTask(taskId);
  return task?.shareConfig ?? { enabled: false, views: 0 };
}

/** Increment the share view counter. Returns false if the view limit is reached. */
export function recordShareView(taskId: string): boolean {
  const task = getTask(taskId);
  if (!task || !task.shareConfig) return true;
  const cfg = task.shareConfig;
  if (cfg.maxViews !== undefined && cfg.views >= cfg.maxViews) return false;
  cfg.views += 1;
  saveTask(task);
  return true;
}

// ── P2-3: Report revision history (criterion #3) ─────────────────────────

/** Save the current report as a named version (dedup vs the latest snapshot). */
export function saveVersion(taskId: string, label?: string, author?: string): ReportVersion | undefined {
  const task = getTask(taskId);
  if (!task || !task.report) return undefined;
  const versions = task.versions ?? [];
  const last = versions[versions.length - 1];
  if (last && last.content === task.report) return last; // identical -> skip
  const v: ReportVersion = {
    id: randomUUID(),
    label: label ?? `v${versions.length + 1}`,
    content: task.report,
    createdAt: Date.now(),
    author,
  };
  versions.push(v);
  if (versions.length > 50) versions.splice(0, versions.length - 50); // bound memory
  task.versions = versions;
  saveTask(task);
  return v;
}

/** Get a specific version snapshot. */
export function getVersion(taskId: string, versionId: string): ReportVersion | undefined {
  const task = getTask(taskId);
  return task?.versions?.find((v) => v.id === versionId);
}

/** Restore the report to a prior version (snapshots the current one first). */
export function restoreVersion(taskId: string, versionId: string, author?: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  const target = task.versions?.find((v) => v.id === versionId);
  if (!target) return false;
  if (task.report && task.report !== target.content) {
    saveVersion(taskId, "恢复前快照", author);
  }
  task.report = target.content;
  saveTask(task);
  return true;
}

/** Edit the report body (auto-snapshots the previous content for traceability). */
export function editReport(taskId: string, content: string, author?: string): AgentTask | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  if (task.report && task.report !== content) {
    // Always record the pre-edit state as a distinct snapshot (edit boundary),
    // even if it matches the latest version content — this marks an edit event.
    const versions = task.versions ?? [];
    versions.push({
      id: randomUUID(),
      label: "编辑前快照",
      content: task.report,
      createdAt: Date.now(),
      author,
    });
    if (versions.length > 50) versions.splice(0, versions.length - 50);
    task.versions = versions;
  }
  task.report = content;
  saveTask(task);
  return task;
}

// ── P2-3: Collaboration comments (inline annotation + discussion) ────────

/** Add a comment (optionally anchored to a citation [n] or a parent). */
export function addComment(
  taskId: string,
  input: { userName: string; text: string; citeN?: number; parentId?: string; userId?: string }
): Comment | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  const comments = task.comments ?? [];
  const c: Comment = {
    id: randomUUID(),
    userId: input.userId,
    userName: input.userName,
    text: input.text,
    citeN: input.citeN,
    parentId: input.parentId,
    createdAt: Date.now(),
  };
  comments.push(c);
  task.comments = comments;
  saveTask(task);
  return c;
}

/** Delete a comment by id. */
export function deleteComment(taskId: string, commentId: string): boolean {
  const task = getTask(taskId);
  if (!task || !task.comments) return false;
  const before = task.comments.length;
  task.comments = task.comments.filter((c) => c.id !== commentId);
  if (task.comments.length === before) return false;
  saveTask(task);
  return true;
}
