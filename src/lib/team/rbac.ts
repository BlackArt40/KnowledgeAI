import type { Role } from "./types";

// Role → capability set. Owner implicitly has everything.
export const ROLE_PERMS: Record<Role, string[]> = {
  owner: [
    "kb.read", "kb.create", "kb.edit", "kb.delete",
    "chat.use", "agent.run",
    "member.invite", "member.manage", "team.settings", "billing.manage",
  ],
  admin: [
    "kb.read", "kb.create", "kb.edit", "kb.delete",
    "chat.use", "agent.run",
    "member.invite", "member.manage",
  ],
  editor: [
    "kb.read", "kb.create", "kb.edit",
    "chat.use", "agent.run",
  ],
  viewer: ["kb.read", "chat.use"],
};

export function can(role: Role, permission: string): boolean {
  return ROLE_PERMS[role].includes(permission);
}

export const ROLE_ORDER: Role[] = ["owner", "admin", "editor", "viewer"];
