// ---------------------------------------------------------------------------
// Workspace (P4-3): multi-tenant organization containers.
//
// A Workspace is the tenant boundary: KBs, conversations and agent tasks
// belong to a workspace, and users only see data of workspaces they are a
// member of. The default workspace `ws_default` ("KnowledgeAI 团队") holds
// all seed users, so existing behavior is unchanged until a user creates /
// switches to another workspace.
//
// Members are stored by EMAIL (stable identifier shared by auth users and
// team members). The Prisma Team model already provides the multi-team DB
// skeleton; this store is the in-memory source of truth (demo mode), mapping
// 1:1 to a Team row in production.
// ---------------------------------------------------------------------------

import { recordAudit } from "@/lib/security/audit";

export type WorkspacePlan = "free" | "pro" | "enterprise";

export interface Workspace {
  id: string;
  name: string;
  plan: WorkspacePlan;
  ownerId: string;
  members: string[]; // member emails
  createdAt: number;
}

export const DEFAULT_WORKSPACE_ID = "ws_default";

type Store = Map<string, Workspace>;
const g = globalThis as unknown as { __KAI_WORKSPACE_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_WORKSPACE_STORE__) {
    // Seed the default workspace with the 4 demo users (mirrors the team).
    const ws: Workspace = {
      id: DEFAULT_WORKSPACE_ID,
      name: "KnowledgeAI 团队",
      plan: "pro",
      ownerId: "usr_owner",
      members: [
        "owner@knowledgeai.dev",
        "admin@knowledgeai.dev",
        "editor@knowledgeai.dev",
        "viewer@knowledgeai.dev",
      ],
      createdAt: Date.now() - 90 * 86_400_000,
    };
    g.__KAI_WORKSPACE_STORE__ = new Map([[ws.id, ws]]);
  }
  return g.__KAI_WORKSPACE_STORE__;
}

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Workspaces the user (by email) is a member of. */
export function listWorkspaces(email: string): Workspace[] {
  return [...store().values()]
    .filter((w) => w.members.includes(email))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getWorkspace(id: string): Workspace | undefined {
  return store().get(id);
}

/** The default workspace (fallback when no cookie / invalid cookie). */
export function getDefaultWorkspace(): Workspace {
  return store().get(DEFAULT_WORKSPACE_ID)!;
}

/** Resolve the effective workspace for a user: explicit id if they are a
 *  member, otherwise the default workspace. */
export function resolveWorkspace(userId: string, email: string, requestedId?: string | null): Workspace {
  if (requestedId) {
    const ws = store().get(requestedId);
    if (ws && ws.members.includes(email)) return ws;
  }
  return getDefaultWorkspace();
}

/** Is the user (by email) a member of this workspace? */
export function workspaceOf(id: string, email: string): boolean {
  const ws = store().get(id);
  return !!ws && ws.members.includes(email);
}

/** Create a workspace (owner = creator). Audited as `workspace.create`. */
export function createWorkspace(input: {
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  memberEmails?: string[];
}): Workspace {
  const ws: Workspace = {
    id: uid("ws"),
    name: input.name.trim() || "新工作区",
    plan: "free",
    ownerId: input.ownerId,
    members: [...new Set([input.ownerEmail, ...(input.memberEmails ?? [])])],
    createdAt: Date.now(),
  };
  store().set(ws.id, ws);
  recordAudit({
    actorId: input.ownerId,
    actor: input.ownerName,
    action: "workspace.create",
    target: ws.name,
    detail: `创建工作区（成员 ${ws.members.length} 人）`,
  });
  return ws;
}

/** Set a workspace's plan (paid via checkout). */
export function setWorkspacePlan(id: string, plan: WorkspacePlan): Workspace | undefined {
  const ws = store().get(id);
  if (!ws) return undefined;
  ws.plan = plan;
  return ws;
}
