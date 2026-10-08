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
// team members) and are persisted (Workspace.members, D2) so membership
// survives a restart. The Prisma Team model is a separate, unrelated
// single-tenant audit/role table - this store is NOT its in-memory mirror.
// ---------------------------------------------------------------------------

import { recordAudit } from "@/lib/security/audit";
import { DEFAULT_BRAND_COLOR } from "@/lib/theme/brand-colors";
import { persistWorkspace } from "@/lib/db/persist";
import { uid } from "@/lib/ids";

export type WorkspacePlan = "free" | "pro" | "enterprise";

export interface Workspace {
  id: string;
  name: string;
  plan: WorkspacePlan;
  ownerId: string;
  members: string[]; // member emails
  createdAt: number;
  /** P5-5: workspace-level brand color (see src/lib/theme/brand-colors.ts). */
  brandColor: string;
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
      brandColor: DEFAULT_BRAND_COLOR,
    };
    g.__KAI_WORKSPACE_STORE__ = new Map([[ws.id, ws]]);
  }
  return g.__KAI_WORKSPACE_STORE__;
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

/** Resolve the effective workspace for a user.
 *
 *  Order (F4 fix, 2026-09-30):
 *    1. an explicitly requested workspace the user is a member of;
 *    2. the DEFAULT workspace, but only when the user is actually a member of
 *       it - this is the long-standing "no cookie / stale cookie -> default"
 *       behaviour and must stay intact (see below);
 *    3. a workspace the user OWNS (their personal workspace);
 *    4. any workspace they are a member of;
 *    5. the default workspace as a last resort.
 *
 *  Why step 2 sits above step 3: the F4 problem is that a self-registered
 *  account is assigned no workspace at all, yet fell back to `ws_default` -
 *  where, because an unnamed KB defaults to "view", it could read every
 *  non-private KB of the default organization. Creating a personal workspace
 *  for new accounts fixes that, but it must not change resolution for anyone
 *  already inside the default workspace: a demo user who creates an extra
 *  workspace still resolves to `ws_default` when no cookie is present
 *  (otherwise every "default workspace" assertion in the acceptance suite
 *  starts looking at the wrong tenant).
 */
export function resolveWorkspace(userId: string, email: string, requestedId?: string | null): Workspace {
  const s = store();
  if (requestedId) {
    const ws = s.get(requestedId);
    if (ws && ws.members.includes(email)) return ws;
  }

  const fallback = getDefaultWorkspace();
  if (fallback.members.includes(email)) return fallback;

  const owned = [...s.values()]
    .filter((w) => w.ownerId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (owned) return owned;

  const memberOf = [...s.values()]
    .filter((w) => w.members.includes(email))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (memberOf) return memberOf;

  return fallback;
}

/** Workspaces the user OWNS (their personal tenant). Used by registration to
 *  decide whether a personal workspace still has to be created. */
export function listOwnedWorkspaces(userId: string): Workspace[] {
  return [...store().values()].filter((w) => w.ownerId === userId);
}

/**
 * F4 (2026-09-30): give a freshly created account its own tenant.
 *
 * Self-registered users used to be assigned no workspace, so `resolveWorkspace`
 * fell back to `ws_default` - and because the default access for an unnamed KB
 * is "view", a brand-new user could read every non-private KB of the default
 * organization. Creating a personal workspace here makes the account's default
 * tenant its own.
 *
 * Idempotent: returns the existing personal workspace when one is already
 * owned by the user. Returns `null` only when the store is unavailable.
 */
export function ensurePersonalWorkspace(input: {
  ownerId: string;
  ownerEmail: string;
  ownerName?: string;
  /** Optional explicit name; defaults to "<name> 的工作区". */
  name?: string;
}): Workspace | null {
  const existing = listOwnedWorkspaces(input.ownerId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (existing) return existing;
  const email = input.ownerEmail.trim().toLowerCase();
  if (!email) return null;
  const display = (input.ownerName || email.split("@")[0] || "用户").trim();
  return createWorkspace({
    name: input.name || `${display} 的工作区`,
    ownerId: input.ownerId,
    ownerEmail: email,
    ownerName: display,
  });
}

/** Is the user (by email) a member of this workspace? */
export function workspaceOf(id: string, email: string): boolean {
  const ws = store().get(id);
  return !!ws && ws.members.includes(email);
}

/** Add a member (by email) to a workspace. Write-through persisted (D2) so
 *  the membership list survives a restart. Idempotent. */
export function addWorkspaceMember(id: string, email: string): Workspace | undefined {
  const ws = store().get(id);
  if (!ws) return undefined;
  if (!ws.members.includes(email)) {
    ws.members = [...ws.members, email];
    void persistWorkspace(ws);
  }
  return ws;
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
    brandColor: DEFAULT_BRAND_COLOR,
  };
  store().set(ws.id, ws);
  void persistWorkspace(ws);
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
  void persistWorkspace(ws);
  return ws;
}

/**
 * Patch workspace fields (P5-5: brandColor). Persisted write-through; audit
 * is recorded by the API route (it knows the actor + old value).
 */
export function updateWorkspace(id: string, patch: { brandColor?: string }): Workspace | undefined {
  const ws = store().get(id);
  if (!ws) return undefined;
  if (patch.brandColor !== undefined) ws.brandColor = patch.brandColor;
  void persistWorkspace(ws);
  return ws;
}
