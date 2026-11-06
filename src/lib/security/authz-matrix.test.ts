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
import { GET as docShareGET } from "@/app/api/knowledge-base/[id]/documents/[docId]/share/route";
import { GET as apiKeysGET, POST as apiKeysPOST } from "@/app/api/api-keys/route";
import { GET as adminUsersGET } from "@/app/api/admin/users/route";
import { GET as teamAuditGET } from "@/app/api/team/audit/route";
import { GET as agentTasksGET } from "@/app/api/agent/tasks/route";
import { POST as wsMembersPOST } from "@/app/api/workspaces/members/route";

import { createToken } from "@/lib/auth/session";
import { findUserByEmail, seed as seedUsers } from "@/lib/auth/store";
import { addDocument, createKb } from "@/lib/kb/store";
import { createWorkspace } from "@/lib/workspace/store";

type Actor = "anon" | "viewer" | "editor" | "owner" | "otherTenant";

const STORE_KEYS = [
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

function resetStores(): void {
  for (const k of STORE_KEYS) delete (globalThis as Record<string, unknown>)[k];
}

beforeEach(() => {
  resetStores();
  seedUsers();

  const kb = createKb({ name: "授权矩阵知识库", desc: "" }, "usr_owner");
  kbId = kb.id;
  docId = addDocument({ kbId, name: "a.md", size: 4, content: "正文", skipEnqueue: true }).id;

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

  it("scopes agent tasks to the caller", async () => {
    const cookie = await cookieFor("viewer");
    const res = await agentTasksGET(req("viewer", cookie, "/api/agent/tasks"));
    const body = (await res.json()) as { tasks: unknown[] };
    expect(body.tasks).toEqual([]);
  });
});
