// P0 (batch 1): authorization matrix — every route is exercised with the same
// five actors (anon / viewer / editor / owner / other-tenant) so a permission
// regression shows up as a table row, not as a manual audit.
//
// Expectations are the CURRENT contract. Where a status is surprising
// (cross-tenant KB access returns 403 rather than 404, which leaks existence),
// the row documents it instead of bending the product code — this batch only
// adds probes.
import { beforeEach, describe, expect, it } from "vitest";

import { GET as kbGET, PATCH as kbPATCH, DELETE as kbDELETE } from "@/app/api/knowledge-base/[id]/route";
import { POST as kbCreatePOST } from "@/app/api/knowledge-base/route";
import { POST as kbSharePOST } from "@/app/api/knowledge-base/[id]/share/route";
import { GET as docShareGET } from "@/app/api/knowledge-base/[id]/documents/[docId]/share/route";
import { PATCH as docPATCH, DELETE as docDELETE } from "@/app/api/knowledge-base/[id]/documents/[docId]/route";
import { GET as apiKeysGET, POST as apiKeysPOST } from "@/app/api/api-keys/route";
import { DELETE as apiKeyDELETE } from "@/app/api/api-keys/[id]/route";
import { GET as adminUsersGET } from "@/app/api/admin/users/route";
import { PATCH as adminUserPATCH, DELETE as adminUserDELETE } from "@/app/api/admin/users/[id]/route";
import { GET as teamAuditGET } from "@/app/api/team/audit/route";
import { PATCH as kbAccessPATCH } from "@/app/api/team/kb-access/route";
import { GET as agentTasksGET } from "@/app/api/agent/tasks/route";
import { POST as wsMembersPOST } from "@/app/api/workspaces/members/route";
import { PATCH as wsPATCH } from "@/app/api/workspaces/route";
import { POST as convPOST } from "@/app/api/chat/conversations/route";
import { PATCH as notifReadPATCH } from "@/app/api/notifications/[id]/read/route";

import { createToken } from "@/lib/auth/session";
import { findUserByEmail, seed as seedUsers } from "@/lib/auth/store";
import { addDocument, createKb } from "@/lib/kb/store";
import { createWorkspace } from "@/lib/workspace/store";

type Actor = "anon" | "viewer" | "editor" | "owner" | "otherTenant";

const STORE_KEYS = [
  "__KAI_CHAT_STORE__",
  "__KAI_KB_STORE__",
  "__KAI_USER_STORE__",
  "__KAI_TEAM_STORE__",
  "__KAI_WORKSPACE_STORE__",
  "__KAI_APIKEY_STORE__",
  "__KAI_AGENT_STORE__",
  "__KAI_AUDIT_STORE__",
  "__KAI_NOTIF_STORE__",
  "__KAI_DOC_SHARE_STORE__",
  "__KAI_RATE_RECENT__",
  "__KAI_RATE_STATS__",
  "__KAI_LOG_STORE__",
  "__KAI_SECURITY_STORE__",
] as const;

let kbId = "";
let docId = "";
let foreignKbId = "";
let foreignWorkspaceId = "";
let viewerUserId = "";

function resetStores(): void {
  for (const k of STORE_KEYS) delete (globalThis as Record<string, unknown>)[k];
}

beforeEach(() => {
  resetStores();
  seedUsers();

  const kb = createKb({ name: "授权矩阵知识库", desc: "" }, "usr_owner");
  kbId = kb.id;
  docId = addDocument({ kbId, name: "a.md", size: 4, content: "正文", skipEnqueue: true }).id;
  viewerUserId = findUserByEmail("viewer@knowledgeai.dev")?.id ?? "";

  // A workspace the default-workspace users are NOT members of.
  const foreign = createWorkspace({
    name: "外部租户",
    ownerId: "usr_admin",
    ownerEmail: "admin@knowledgeai.dev",
    ownerName: "李芳（Admin）",
  });
  foreignWorkspaceId = foreign.id;
  foreignKbId = createKb({ name: "外部租户知识库", desc: "" }, "usr_admin", foreign.id).id;
});

async function cookieFor(actor: Actor): Promise<string> {
  if (actor === "anon") return "";
  const email = actor === "otherTenant" ? "admin@knowledgeai.dev" : `${actor === "owner" ? "owner" : actor}@knowledgeai.dev`;
  const user = findUserByEmail(email);
  if (!user) throw new Error(`seed user missing: ${email}`);
  const token = await createToken(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    60
  );
  const wsCookie = actor === "otherTenant" ? `; kai-workspace=${foreignWorkspaceId}` : "";
  return `kai-token=${token}${wsCookie}`;
}

function req(_actor: Actor, cookie: string, path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
}

const kbParams = () => ({ params: Promise.resolve({ id: kbId }) });
const docParams = () => ({ params: Promise.resolve({ id: kbId, docId }) });

interface Row {
  label: string;
  actor: Actor;
  expected: number;
  run: (cookie: string, req_: (a: Actor, p: string, i?: RequestInit) => Request) => Promise<Response | undefined>;
}

/** JSON init shorthand for the mutating rows. */
function json(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
  return { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
}

const ACTORS: Actor[] = ["anon", "viewer", "editor", "owner", "otherTenant"];

/** One route × the five actors, with the expected status per actor. */
function perActor(
  label: string,
  expected: Record<Actor, number>,
  run: (actor: Actor, r: (a: Actor, p: string, i?: RequestInit) => Request) => Promise<Response | undefined>
): Row[] {
  return ACTORS.map((actor) => ({
    label,
    actor,
    expected: expected[actor],
    run: (_cookie, r) => run(actor, r),
  }));
}

/**
 * Batch 4: every write endpoint that can run against the in-memory stores
 * (no LLM / Stripe / S3), each with the same five actors. Expectations are the
 * current contract; a surprising status is documented in a comment rather than
 * "fixed" here.
 */
function mutatingRows(): Row[] {
  const kb = { name: "矩阵新建知识库" };

  return [
    // Creating a KB requires EDITOR+ (viewer is read-only by design).
    ...perActor(
      "POST kb (create)",
      { anon: 401, viewer: 403, editor: 201, owner: 201, otherTenant: 201 },
      (a, r) => kbCreatePOST(r(a, "/api/knowledge-base", json("POST", kb)))
    ),

    // Share config is an edit-level action (canEditKb), not owner-only.
    ...perActor(
      "POST kb share",
      { anon: 401, viewer: 403, editor: 403, owner: 201, otherTenant: 403 },
      (a, r) => kbSharePOST(r(a, `/api/knowledge-base/${kbId}/share`, json("POST", {})), kbParams())
    ),

    // The fixture KB is shared view-only, so only the owner holds edit rights on
    // its documents (canEditDoc falls back to canEditKb for non-owners).
    ...perActor(
      "PATCH doc access",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 403 },
      (a, r) =>
        docPATCH(r(a, `/api/knowledge-base/${kbId}/documents/${docId}`, json("PATCH", { access: "view" })), docParams())
    ),

    ...perActor(
      "DELETE doc",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 403 },
      (a, r) => docDELETE(r(a, `/api/knowledge-base/${kbId}/documents/${docId}`, { method: "DELETE" }), docParams())
    ),

    // KB member permissions: only owner/admin (or the KB owner) may adjust.
    ...perActor(
      "PATCH team kb-access",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 403 },
      (a, r) => kbAccessPATCH(r(a, "/api/team/kb-access", json("PATCH", { kbId, access: "view" })))
    ),

    // Conversations are per-user; no KB membership gate on create.
    ...perActor(
      "POST chat conversation",
      { anon: 401, viewer: 201, editor: 201, owner: 201, otherTenant: 201 },
      (a, r) => convPOST(r(a, "/api/chat/conversations", json("POST", { kbId })))
    ),

    // Marking a notification read is scoped to the caller and idempotent.
    ...perActor(
      "PATCH notification read",
      { anon: 401, viewer: 200, editor: 200, owner: 200, otherTenant: 200 },
      (a, r) =>
        notifReadPATCH(r(a, "/api/notifications/notif_x/read", { method: "PATCH" }), {
          params: Promise.resolve({ id: "notif_x" }),
        })
    ),

    // Workspace theme: only the workspace owner (otherTenant owns theirs).
    ...perActor(
      "PATCH workspace",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 200 },
      (a, r) => wsPATCH(r(a, "/api/workspaces", json("PATCH", { brandColor: "emerald" })))
    ),

    // Account status: owner/admin only (role gate, not tenant gate).
    ...perActor(
      "PATCH admin user status",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 200 },
      (a, r) =>
        adminUserPATCH(r(a, `/api/admin/users/${viewerUserId}`, json("PATCH", { status: "banned" })), {
          params: Promise.resolve({ id: viewerUserId }),
        })
    ),

    // Hard delete: owner only (otherTenant is merely an admin).
    ...perActor(
      "DELETE admin user",
      { anon: 401, viewer: 403, editor: 403, owner: 200, otherTenant: 403 },
      (a, r) =>
        adminUserDELETE(r(a, `/api/admin/users/${viewerUserId}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: viewerUserId }),
        })
    ),

    // Revoking an API key never reveals whether another user's key exists.
    ...perActor(
      "DELETE api-key (foreign id)",
      { anon: 401, viewer: 404, editor: 404, owner: 404, otherTenant: 404 },
      (a, r) =>
        apiKeyDELETE(r(a, "/api/api-keys/key_missing", { method: "DELETE" }), {
          params: Promise.resolve({ id: "key_missing" }),
        })
    ),
  ];
}

const rows: Row[] = [
  // ── KB detail (shared access = "view") ────────────────────────────────
  {
    label: "GET kb",
    actor: "anon",
    expected: 401,
    run: (_c, r) => kbGET(r("anon", `/api/knowledge-base/${kbId}`, { method: "GET" }), kbParams()),
  },
  {
    label: "GET kb",
    actor: "viewer",
    expected: 200,
    run: (_c, r) => kbGET(r("viewer", `/api/knowledge-base/${kbId}`), kbParams()),
  },
  {
    label: "GET kb",
    actor: "editor",
    expected: 200,
    run: (_c, r) => kbGET(r("editor", `/api/knowledge-base/${kbId}`), kbParams()),
  },
  {
    label: "GET kb",
    actor: "owner",
    expected: 200,
    run: (_c, r) => kbGET(r("owner", `/api/knowledge-base/${kbId}`), kbParams()),
  },
  {
    label: "GET kb",
    actor: "otherTenant",
    expected: 403,
    run: (_c, r) => kbGET(r("otherTenant", `/api/knowledge-base/${kbId}`), kbParams()),
  },

  // ── KB settings (edit permission required) ────────────────────────────
  {
    label: "PATCH kb",
    actor: "anon",
    expected: 401,
    run: (_c, r) => kbPATCH(r("anon", `/api/knowledge-base/${kbId}`, { method: "PATCH", body: "{}" }), kbParams()),
  },
  {
    label: "PATCH kb",
    actor: "viewer",
    expected: 403,
    run: (_c, r) => kbPATCH(r("viewer", `/api/knowledge-base/${kbId}`, { method: "PATCH", body: "{}" }), kbParams()),
  },
  {
    label: "PATCH kb",
    actor: "editor",
    expected: 403,
    run: (_c, r) => kbPATCH(r("editor", `/api/knowledge-base/${kbId}`, { method: "PATCH", body: "{}" }), kbParams()),
  },
  {
    label: "PATCH kb",
    actor: "owner",
    expected: 200,
    run: (_c, r) =>
      kbPATCH(
        r("owner", `/api/knowledge-base/${kbId}`, {
          method: "PATCH",
          body: JSON.stringify({ chunkSize: 300 }),
          headers: { "Content-Type": "application/json" },
        }),
        kbParams()
      ),
  },
  {
    label: "PATCH kb",
    actor: "otherTenant",
    expected: 403,
    run: (_c, r) => kbPATCH(r("otherTenant", `/api/knowledge-base/${kbId}`, { method: "PATCH", body: "{}" }), kbParams()),
  },

  // ── KB delete (owner only) ────────────────────────────────────────────
  {
    label: "DELETE kb",
    actor: "anon",
    expected: 401,
    run: (_c, r) => kbDELETE(r("anon", `/api/knowledge-base/${kbId}`, { method: "DELETE" }), kbParams()),
  },
  {
    label: "DELETE kb",
    actor: "viewer",
    expected: 403,
    run: (_c, r) => kbDELETE(r("viewer", `/api/knowledge-base/${kbId}`, { method: "DELETE" }), kbParams()),
  },
  {
    label: "DELETE kb",
    actor: "editor",
    expected: 403,
    run: (_c, r) => kbDELETE(r("editor", `/api/knowledge-base/${kbId}`, { method: "DELETE" }), kbParams()),
  },
  {
    label: "DELETE kb",
    actor: "owner",
    expected: 200,
    run: (_c, r) => kbDELETE(r("owner", `/api/knowledge-base/${kbId}`, { method: "DELETE" }), kbParams()),
  },
  {
    label: "DELETE kb",
    actor: "otherTenant",
    expected: 403,
    run: (_c, r) => kbDELETE(r("otherTenant", `/api/knowledge-base/${kbId}`, { method: "DELETE" }), kbParams()),
  },

  // ── document share link (per-doc edit permission) ─────────────────────
  {
    label: "GET doc share",
    actor: "anon",
    expected: 401,
    run: (_c, r) => docShareGET(r("anon", `/api/knowledge-base/${kbId}/documents/${docId}/share`), docParams()),
  },
  {
    label: "GET doc share",
    actor: "viewer",
    expected: 403,
    run: (_c, r) => docShareGET(r("viewer", `/api/knowledge-base/${kbId}/documents/${docId}/share`), docParams()),
  },
  {
    label: "GET doc share",
    actor: "editor",
    expected: 403,
    run: (_c, r) => docShareGET(r("editor", `/api/knowledge-base/${kbId}/documents/${docId}/share`), docParams()),
  },
  {
    label: "GET doc share",
    actor: "owner",
    expected: 200,
    run: (_c, r) => docShareGET(r("owner", `/api/knowledge-base/${kbId}/documents/${docId}/share`), docParams()),
  },
  {
    label: "GET doc share",
    actor: "otherTenant",
    expected: 403,
    run: (_c, r) => docShareGET(r("otherTenant", `/api/knowledge-base/${kbId}/documents/${docId}/share`), docParams()),
  },

  // ── API keys (self-service, never cross-user) ─────────────────────────
  {
    label: "GET api-keys",
    actor: "anon",
    expected: 401,
    run: (_c, r) => apiKeysGET(r("anon", "/api/api-keys")),
  },
  {
    label: "GET api-keys",
    actor: "viewer",
    expected: 200,
    run: (_c, r) => apiKeysGET(r("viewer", "/api/api-keys")),
  },
  {
    label: "GET api-keys",
    actor: "editor",
    expected: 200,
    run: (_c, r) => apiKeysGET(r("editor", "/api/api-keys")),
  },
  {
    label: "GET api-keys",
    actor: "owner",
    expected: 200,
    run: (_c, r) => apiKeysGET(r("owner", "/api/api-keys")),
  },
  {
    label: "GET api-keys",
    actor: "otherTenant",
    expected: 200,
    run: (_c, r) => apiKeysGET(r("otherTenant", "/api/api-keys")),
  },
  {
    label: "POST api-keys (bad scope)",
    actor: "anon",
    expected: 401,
    run: (_c, r) =>
      apiKeysPOST(r("anon", "/api/api-keys", { method: "POST", body: JSON.stringify({ name: "x", scopes: ["root"] }) })),
  },
  {
    label: "POST api-keys (bad scope)",
    actor: "viewer",
    expected: 400,
    run: (_c, r) =>
      apiKeysPOST(r("viewer", "/api/api-keys", { method: "POST", body: JSON.stringify({ name: "x", scopes: ["root"] }) })),
  },
  {
    label: "POST api-keys (bad scope)",
    actor: "editor",
    expected: 400,
    run: (_c, r) =>
      apiKeysPOST(r("editor", "/api/api-keys", { method: "POST", body: JSON.stringify({ name: "x", scopes: ["root"] }) })),
  },
  {
    label: "POST api-keys (bad scope)",
    actor: "owner",
    expected: 400,
    run: (_c, r) =>
      apiKeysPOST(r("owner", "/api/api-keys", { method: "POST", body: JSON.stringify({ name: "x", scopes: ["root"] }) })),
  },
  {
    label: "POST api-keys (bad scope)",
    actor: "otherTenant",
    expected: 400,
    run: (_c, r) =>
      apiKeysPOST(
        r("otherTenant", "/api/api-keys", { method: "POST", body: JSON.stringify({ name: "x", scopes: ["root"] }) })
      ),
  },

  // ── admin users (owner/admin only, JWT only) ──────────────────────────
  {
    label: "GET admin users",
    actor: "anon",
    expected: 401,
    run: (_c, r) => adminUsersGET(r("anon", "/api/admin/users")),
  },
  {
    label: "GET admin users",
    actor: "viewer",
    expected: 403,
    run: (_c, r) => adminUsersGET(r("viewer", "/api/admin/users")),
  },
  {
    label: "GET admin users",
    actor: "editor",
    expected: 403,
    run: (_c, r) => adminUsersGET(r("editor", "/api/admin/users")),
  },
  {
    label: "GET admin users",
    actor: "owner",
    expected: 200,
    run: (_c, r) => adminUsersGET(r("owner", "/api/admin/users")),
  },
  {
    label: "GET admin users",
    actor: "otherTenant",
    expected: 200, // same actor is a seeded admin — role gate, not tenant gate
    run: (_c, r) => adminUsersGET(r("otherTenant", "/api/admin/users")),
  },

  // ── team audit (member.manage) ────────────────────────────────────────
  {
    label: "GET team audit",
    actor: "anon",
    expected: 401,
    run: (_c, r) => teamAuditGET(r("anon", "/api/team/audit")),
  },
  {
    label: "GET team audit",
    actor: "viewer",
    expected: 403,
    run: (_c, r) => teamAuditGET(r("viewer", "/api/team/audit")),
  },
  {
    label: "GET team audit",
    actor: "editor",
    expected: 403,
    run: (_c, r) => teamAuditGET(r("editor", "/api/team/audit")),
  },
  {
    label: "GET team audit",
    actor: "owner",
    expected: 200,
    run: (_c, r) => teamAuditGET(r("owner", "/api/team/audit")),
  },
  {
    label: "GET team audit",
    actor: "otherTenant",
    expected: 200, // admin also holds member.manage
    run: (_c, r) => teamAuditGET(r("otherTenant", "/api/team/audit")),
  },

  // ── agent tasks (own tasks only) ──────────────────────────────────────
  {
    label: "GET agent tasks",
    actor: "anon",
    expected: 401,
    run: (_c, r) => agentTasksGET(r("anon", "/api/agent/tasks")),
  },
  {
    label: "GET agent tasks",
    actor: "viewer",
    expected: 200,
    run: (_c, r) => agentTasksGET(r("viewer", "/api/agent/tasks")),
  },
  {
    label: "GET agent tasks",
    actor: "editor",
    expected: 200,
    run: (_c, r) => agentTasksGET(r("editor", "/api/agent/tasks")),
  },
  {
    label: "GET agent tasks",
    actor: "owner",
    expected: 200,
    run: (_c, r) => agentTasksGET(r("owner", "/api/agent/tasks")),
  },
  {
    label: "GET agent tasks",
    actor: "otherTenant",
    expected: 200,
    run: (_c, r) => agentTasksGET(r("otherTenant", "/api/agent/tasks")),
  },

  // ── workspace members (owner-only management) ─────────────────────────
  {
    label: "POST ws members",
    actor: "anon",
    expected: 401,
    run: (_c, r) =>
      wsMembersPOST(r("anon", "/api/workspaces/members", { method: "POST", body: JSON.stringify({ email: "x" }) })),
  },
  {
    label: "POST ws members",
    actor: "viewer",
    expected: 403,
    run: (_c, r) =>
      wsMembersPOST(r("viewer", "/api/workspaces/members", { method: "POST", body: JSON.stringify({ email: "x" }) })),
  },
  {
    label: "POST ws members",
    actor: "editor",
    expected: 403,
    run: (_c, r) =>
      wsMembersPOST(r("editor", "/api/workspaces/members", { method: "POST", body: JSON.stringify({ email: "x" }) })),
  },
  {
    label: "POST ws members",
    actor: "owner",
    expected: 400, // owner passes the gate, then fails email validation
    run: (_c, r) =>
      wsMembersPOST(
        r("owner", "/api/workspaces/members", { method: "POST", body: JSON.stringify({ email: "not-an-email" }) })
      ),
  },
  {
    label: "POST ws members",
    actor: "otherTenant",
    // The actor owns the foreign workspace, so the ownership gate passes for
    // HIS tenant; the request then fails on membership (400). It never reaches
    // ws_default even though the same admin is a member there.
    expected: 400,
    run: (_c, r) =>
      wsMembersPOST(
        r("otherTenant", "/api/workspaces/members", { method: "POST", body: JSON.stringify({ email: "x@y.z" }) })
      ),
  },

  // ── mutating routes (batch 4): every write path with the same five actors ──
  ...mutatingRows(),
];

describe("authorization matrix", () => {
  it.each(rows)("$label as $actor -> $expected", async ({ actor, expected, run }) => {
    const cookie = await cookieFor(actor);
    const res = await run(cookie, (a, p, i) => req(a, cookie, p, i));
    expect(res?.status).toBe(expected);
  });
});

describe("cross-tenant probes", () => {
  it("hides a knowledge base that belongs to another workspace", async () => {
    const cookie = await cookieFor("owner");
    const res = await kbGET(req("owner", cookie, `/api/knowledge-base/${foreignKbId}`), {
      params: Promise.resolve({ id: foreignKbId }),
    });
    expect(res?.status).toBe(403);
  });

  it("never returns another user's API keys", async () => {
    const viewerCookie = await cookieFor("viewer");
    const created = await apiKeysPOST(
      req("viewer", viewerCookie, "/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "viewer-key", scopes: [] }),
      })
    );
    expect(created.status).toBe(201);

    const ownerCookie = await cookieFor("owner");
    const res = await apiKeysGET(req("owner", ownerCookie, "/api/api-keys"));
    const body = (await res.json()) as { keys: Array<{ name: string }> };
    expect(body.keys).toEqual([]);
  });

  it("never deletes another user's API key (404, and the key survives)", async () => {
    const viewerCookie = await cookieFor("viewer");
    await apiKeysPOST(
      req("viewer", viewerCookie, "/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "viewer-key-2", scopes: [] }),
      })
    );
    const listed = (await (await apiKeysGET(req("viewer", viewerCookie, "/api/api-keys"))).json()) as {
      keys: Array<{ id: string }>;
    };
    const keyId = listed.keys[0]?.id;
    expect(keyId).toBeTruthy();

    const ownerCookie = await cookieFor("owner");
    const del = await apiKeyDELETE(req("owner", ownerCookie, `/api/api-keys/${keyId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: keyId }),
    });
    expect(del.status).toBe(404);

    const after = (await (await apiKeysGET(req("viewer", viewerCookie, "/api/api-keys"))).json()) as {
      keys: Array<{ id: string }>;
    };
    expect(after.keys.map((k) => k.id)).toContain(keyId);
  });

  it("refuses to change document access in another workspace's KB", async () => {
    const foreignDocId = addDocument({
      kbId: foreignKbId,
      name: "b.md",
      size: 2,
      content: "x",
      skipEnqueue: true,
    }).id;
    const cookie = await cookieFor("owner");

    const res = await docPATCH(
      req("owner", cookie, `/api/knowledge-base/${foreignKbId}/documents/${foreignDocId}`, json("PATCH", { access: "view" })),
      { params: Promise.resolve({ id: foreignKbId, docId: foreignDocId }) }
    );
    expect(res?.status).toBe(403);
  });

  it("scopes agent tasks to the caller", async () => {
    const cookie = await cookieFor("viewer");
    const res = await agentTasksGET(req("viewer", cookie, "/api/agent/tasks"));
    const body = (await res.json()) as { tasks: unknown[] };
    expect(body.tasks).toEqual([]);
  });
});
