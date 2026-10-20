// ---------------------------------------------------------------------------
// Ownership-scoped file keys.
//
// `/api/files/[key]` used to accept any authenticated user's request for any
// key (IDOR): the key was unguessable, but it is not a credential - it leaks
// through share links, logs and rendered pages. New keys embed the owner id as
// a namespace so the route can enforce ownership with a constant-time-ish
// prefix check. Keys created before this change (flat UUID.ext) are legacy
// artifacts of the unused saveFile() helper and are intentionally rejected.
// ---------------------------------------------------------------------------

const OWNER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const EXT_RE = /^\.[a-zA-Z0-9]{1,16}$/;

/** Build `<ownerId>__<fileId><ext>`; throws on an unsafe owner id. */
export function buildOwnedFileKey(ownerId: string, fileId: string, ext: string): string {
  if (!OWNER_ID_RE.test(ownerId)) throw new Error("非法文件所有者");
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(fileId)) throw new Error("非法文件标识");
  const safeExt = EXT_RE.test(ext) ? ext.toLowerCase() : "";
  return `${ownerId}__${fileId}${safeExt}`;
}

/** Whether `key` is namespaced to `ownerId` (used by the download route). */
export function isFileKeyOwnedBy(key: string, ownerId: string): boolean {
  if (!OWNER_ID_RE.test(ownerId)) return false;
  return key.startsWith(`${ownerId}__`) && key.length > ownerId.length + 2;
}
