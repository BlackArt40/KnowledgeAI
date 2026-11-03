// 成员维度用量：仅管理者可见，数据来自每用户计量。
import { beforeEach, describe, expect, it } from "vitest";
import { GET as usageGET } from "@/app/api/usage/route";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import { createTask } from "@/lib/agent/store";
import { recordQa } from "@/lib/billing/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const EDITOR = { id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "editor" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}
function req(cookie: string): Request {
  return new Request("http://localhost/api/usage", { headers: { cookie } });
}

beforeEach(() => {
  for (const key of [
    "__KAI_USER_STORE__",
    "__KAI_TEAM_STORE__",
    "__KAI_WORKSPACE_STORE__",
    "__KAI_BILLING_STORE__",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
});

describe("GET /api/usage 成员维度", () => {
  it("owner 看到成员明细；editor 只拿到工作区 + 自己", async () => {
    recordQa(EDITOR.id, "ws_default");
    recordQa(EDITOR.id, "ws_default");
    // 与 run-handler 同口径：任务创建即计入该成员的 agentTasks
    createTask(
      { topic: "成员用量验收", outputFormat: "report", agents: ["writer"], maxSteps: 5 },
      EDITOR.id,
      "ws_default"
    );

    const asOwner = await usageGET(req(await cookieFor(OWNER)));
    expect(asOwner!.status).toBe(200);
    const ownerBody = (await asOwner!.json()) as {
      members?: Array<{ email: string; qaUsed: number; agentTasks: number }>;
    };
    const editorRow = ownerBody.members?.find((m) => m.email === EDITOR.email);
    expect(editorRow).toMatchObject({ qaUsed: 2, agentTasks: 1 });

    const asEditor = await usageGET(req(await cookieFor(EDITOR)));
    expect(asEditor!.status).toBe(200);
    const editorBody = (await asEditor!.json()) as { members?: unknown };
    expect(editorBody.members).toBeUndefined();
  });
});
