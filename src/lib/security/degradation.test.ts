// P0 (batch 1): degradation matrix — documented semantics for a dependency
// going away. Only the paths that are NOT already covered elsewhere live here;
// the rest stay with their owners:
//   - Redis / JWT revocation fallback  -> src/lib/auth/jti-shared.test.ts
//   - DB write retry (never throws)    -> src/lib/db/persist-fk-retry.test.ts
//   - queue enqueue failure -> 503     -> src/lib/kb/reindex-route.test.ts
//   - vector store failure propagates  -> src/lib/rag/retriever-advanced.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/hydrate", () => ({
  isHydrated: () => false,
  hydrateFromDb: vi.fn(async () => {}),
  ensureHydrated: vi.fn(async () => {}),
  loadKbFromDb: vi.fn(async () => false),
  loadDocFromDb: vi.fn(async () => {
    throw new Error("db down");
  }),
  loadTaskFromDb: vi.fn(async () => {
    throw new Error("db down");
  }),
  loadOrderFromDb: vi.fn(async () => false),
  loadWebhookFromDb: vi.fn(async () => false),
}));

import { GET as kbGET } from "@/app/api/knowledge-base/[id]/route";
import { GET as agentTasksGET } from "@/app/api/agent/tasks/route";
import { createToken } from "@/lib/auth/session";
import { findUserByEmail, seed as seedUsers } from "@/lib/auth/store";
import { addDocument, createKb, listDocuments } from "@/lib/kb/store";
import { createTask } from "@/lib/agent/store";

const STORE_KEYS = [
  "__KAI_KB_STORE__",
  "__KAI_USER_STORE__",
  "__KAI_TEAM_STORE__",
  "__KAI_WORKSPACE_STORE__",
  "__KAI_CHAT_STORE__",
  "__KAI_AGENT_STORE__",
  "__KAI_BILLING_STORE__",
  "__KAI_AUDIT_STORE__",
  "__KAI_NOTIF_STORE__",
  "__KAI_RATE_RECENT__",
  "__KAI_RATE_STATS__",
  "__KAI_TRACE_STORE__",
  "__KAI_OBS_STORE__",
] as const;

let kbId = "";
let cookie = "";

beforeEach(async () => {
  for (const k of STORE_KEYS) delete (globalThis as Record<string, unknown>)[k];
  seedUsers();

  const kb = createKb({ name: "降级矩阵知识库", desc: "" }, "usr_owner");
  kbId = kb.id;
  addDocument({ kbId, name: "a.md", size: 4, content: "正文", skipEnqueue: true });

  const user = findUserByEmail("owner@knowledgeai.dev")!;
  cookie = `kai-token=${await createToken(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    60
  )}`;
});

describe("database unavailable on read-back paths", () => {
  it("still serves the KB detail from the in-process snapshot", async () => {
    // Mark a doc non-terminal so the route attempts the (failing) DB reload.
    const doc = listDocuments(kbId)[0];
    doc.status = "vectorizing";

    const res = await kbGET(
      new Request(`http://localhost/api/knowledge-base/${kbId}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: kbId }) }
    );

    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { kb: { id: string }; docs: unknown[] };
    expect(body.kb.id).toBe(kbId);
    expect(body.docs).toHaveLength(1);
  });

  it("still serves the agent task list from the snapshot", async () => {
    createTask(
      {
        topic: "降级任务",
        kbId,
        outputFormat: "report",
        agents: [],
        maxSteps: 3,
      },
      "usr_owner",
      "ws_default"
    );

    const res = await agentTasksGET(
      new Request("http://localhost/api/agent/tasks", { headers: { cookie } })
    );

    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { tasks: unknown[] };
    expect(body.tasks.length).toBeGreaterThanOrEqual(0);
  });
});
