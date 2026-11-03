// @mention parsing for report comments.
//
// Matches the handles a member actually recognises: the full email or the
// display name as stored on the team ("王浩（Editor）"). Substring matching is
// deliberate - the comment is free text and we only need to decide whether a
// handle appears; a regex would break on Chinese punctuation and emails.
import type { Member } from "./types";

export function extractMentionedMembers(text: string, members: Member[]): Member[] {
  const found = new Map<string, Member>();
  for (const member of members) {
    if (member.status === "suspended") continue;
    const handles = [`@${member.email}`, `@${member.name}`].filter((h) => h.length > 1);
    if (handles.some((h) => text.includes(h))) found.set(member.id, member);
  }
  return [...found.values()];
}
