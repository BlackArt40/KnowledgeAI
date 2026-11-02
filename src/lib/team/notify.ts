// ---------------------------------------------------------------------------
// Team activity notifications (2026-11)
//
// "Observability" is only useful if the affected people hear about it:
// membership/role changes notify the target member, KB grants notify the
// grantee, shared-access changes notify the team, and public share links
// notify the other managers. Everything goes through the `teamActivity`
// channel so users can mute it from Settings → Profile.
// ---------------------------------------------------------------------------

import { findUserByEmail, getUserById } from "@/lib/auth/store";
import { notify } from "@/lib/notifications/store";
import { listMembers } from "./store";
import type { Role } from "./types";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export function roleLabel(role: Role | string): string {
  return ROLE_LABEL[role as Role] ?? String(role);
}

interface TeamNotification {
  title: string;
  body: string;
  link?: string;
}

interface NotifyOptions {
  /** Do not notify the person who performed the action. */
  exceptUserId?: string | null;
  /** Extra account to include for manager-only events (e.g. KB owner). */
  includeUserId?: string | null;
}

/** Notify one account by user id (no-op when missing / self). */
export function notifyUserId(
  userId: string | null | undefined,
  input: TeamNotification,
  opts: NotifyOptions = {}
) {
  if (!userId || userId === opts.exceptUserId) return null;
  return notify(userId, "teamActivity", input.title, input.body, input.link);
}

/** Notify one team member by email (accounts only; invited-only rows skip). */
export function notifyMember(
  email: string,
  input: TeamNotification,
  opts: NotifyOptions = {}
) {
  return notifyUserId(findUserByEmail(email)?.id, input, opts);
}

/** Notify every active team member (shared-access changes). */
export function notifyTeam(input: TeamNotification, opts: NotifyOptions = {}): number {
  return notifyAccounts(
    listMembers()
      .filter((m) => m.status !== "suspended")
      .map((m) => m.email),
    input,
    opts
  );
}

/** Notify team owners/admins (public share links are security-relevant). */
export function notifyManagers(input: TeamNotification, opts: NotifyOptions = {}): number {
  const ids = new Set<string>();
  for (const m of listMembers()) {
    if (m.role !== "owner" && m.role !== "admin") continue;
    const account = findUserByEmail(m.email);
    if (account) ids.add(account.id);
  }
  if (opts.includeUserId) ids.add(opts.includeUserId);
  let sent = 0;
  for (const id of ids) {
    if (notifyUserId(id, input, opts)) sent++;
  }
  return sent;
}

function notifyAccounts(
  emails: string[],
  input: TeamNotification,
  opts: NotifyOptions
): number {
  const seen = new Set<string>();
  let sent = 0;
  for (const email of emails) {
    const account = findUserByEmail(email);
    if (!account || account.id === opts.exceptUserId || seen.has(account.id)) continue;
    seen.add(account.id);
    if (notify(account.id, "teamActivity", input.title, input.body, input.link)) sent++;
  }
  return sent;
}

/** Convenience for routes that already hold an owner id. */
export function notifyKbOwner(
  ownerId: string,
  input: TeamNotification,
  opts: NotifyOptions = {}
) {
  return notifyUserId(getUserById(ownerId)?.id, input, opts);
}
