import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/agent/public/[id]/route";
import { createTask, getTask, setShareConfig } from "./store";

function makeCompletedTask() {
  const task = createTask(
    {
      topic: "Public report default test",
      outputFormat: "report",
      agents: ["writer"],
      maxSteps: 1,
    },
    "usr_owner",
    "ws_default"
  );
  task.status = "done";
  task.report = "private report body";
  return task;
}

function getPublic(id: string) {
  return GET(new Request(`http://localhost/api/agent/public/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/agent/public/[id]", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__KAI_AGENT_STORE__;
  });

  it("defaults to non-public when a task has no share config", async () => {
    const task = makeCompletedTask();
    delete task.shareConfig;

    const res = await getPublic(task.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "disabled" });
  });

  it("allows public access only after sharing is explicitly enabled", async () => {
    const task = makeCompletedTask();
    setShareConfig(task.id, { enabled: true });

    const res = await getPublic(task.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ report: "private report body" });
    expect(getTask(task.id)?.shareConfig?.views).toBe(1);
  });
});
