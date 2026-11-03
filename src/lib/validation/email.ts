/** Single source of truth for the lightweight email shape check used by
 *  unauthenticated auth flows, team invites and workspace member management.
 *  (Deliberately permissive: real deliverability is proven by the mail link.) */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
