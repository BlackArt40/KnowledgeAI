import type { Role } from "./types";

/** Every capability the API can gate on. Keep this list as the single source
 *  of truth: routes pass these literals to `can()` and the team permission
 *  matrix renders exactly this set. */
export type Permission =
  | "kb.read"
  | "kb.create"
  | "kb.edit"
  | "kb.delete"
  | "chat.use"
  | "agent.run"
  | "member.invite"
  | "member.manage"
  | "team.settings"
  | "billing.manage";

// Roles build on the tier below instead of repeating the whole list, so a new
// capability added to a lower tier is inherited upwards automatically.
// (Owner used to repeat all 10 entries by hand, which silently drifted.)
const VIEWER: Permission[] = ["kb.read", "chat.use"];
const EDITOR: Permission[] = [...VIEWER, "kb.create", "kb.edit", "agent.run"];
const ADMIN: Permission[] = [...EDITOR, "kb.delete", "member.invite", "member.manage"];
const OWNER: Permission[] = [...ADMIN, "team.settings", "billing.manage"];

export const ROLE_PERMS: Record<Role, Permission[]> = {
  owner: OWNER,
  admin: ADMIN,
  editor: EDITOR,
  viewer: VIEWER,
};

/** Capability check. `permission` is the literal union, so a typo at a route
 *  call site is a compile error (it used to be hidden behind `as never`). */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMS[role].some((p) => p === permission);
}

/** Highest → lowest. Also the option order in every role picker. */
export const ROLE_ORDER: Role[] = ["owner", "admin", "editor", "viewer"];

/** 0 = highest. Used for "who may manage whom" comparisons; never persist it. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 0,
  admin: 1,
  editor: 2,
  viewer: 3,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_RANK;
}

/** True when `actor` sits strictly above `target` in the role hierarchy.
 *  Peers and superiors are out of reach: an admin cannot demote another admin,
 *  and nobody can manage the owner. */
export function outranks(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] < ROLE_RANK[target];
}

/** Roles the actor may hand out / invite at: strictly below their own rank.
 *  An admin cannot mint peers (or owners); an owner can appoint admins. */
export function assignableRoles(actor: Role): Role[] {
  return ROLE_ORDER.filter((role) => outranks(actor, role));
}
