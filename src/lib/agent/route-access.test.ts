// Agent 报告写操作的权限与协作闭环回归：
//   - viewer（只读角色）不能编辑正文 / 保存或恢复版本
//   - 公开分享配置只有任务所有者或 Owner/Admin 能改，普通成员只读
//   - 评论通知任务所有者与（回复时）被回复者，且不通知操作者自己
import { beforeEach, describe, expect, it } from "vitest";
import { PUT as reportPUT } from "@/app/api/agent/tasks/[id]/report/route";
import { POST as versionsPOST } from "@/app/api/agent/tasks/[id]/versions/route";
import { POST as restorePOST } from "@/app/api/agent/tasks/[id]/versions/[vid]/route";
import { GET as shareGET, PUT as sharePUT } from "@/app/api/agent/tasks/[id]/share/route";
import { POST as commentsPOST } from "@/app/api/agent/tasks/[id]/comments/route";
import { createTask, saveTask, saveVersion } from "@/lib/agent/store";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import { listNotifications } from "@/lib/notifications/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const ADMIN = { id: "usr_admin", email: "admin@knowledgeai.dev", name: "李芳（Admin）", role: "admin" as Role };
const EDITOR = { id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "editor" as Role };
const VIEWER = { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}

function jsonRequest(cookie: string, method: string, body: unknown): Request {
  return new Request("http://localhost/api/agent/x", {
    method,
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(cookie: string): Request {
  return new Request("http://localhost/api/agent/x", { headers: { cookie } });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const versionParams = (id: string, vid: string) => ({ params: Promise.resolve({ id, vid }) });

/** Task owned by OWNER in the default workspace, already finished with a body. */
function finishedTask(report = "# 初始报告\n\n正文内容") {
  const task = createTask(
    { topic: "权限与协作验收", outputFormat: "report", agents: ["writer"], maxSteps: 5 },
    OWNER.id,
    "ws_default"
  );
  task.report = report;
  task.status = "done";
  saveTask(task);
  return task;
}

beforeEach(() => {
  for (const key of [
    "__KAI_AGENT_STORE__",
    "__KAI_USER_STORE__",
    "__KAI_NOTIF_STORE__",
    "__KAI_TEAM_STORE__",
    "__KAI_WORKSPACE_STORE__",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
});

describe("Agent 报告写操作的角色边界", () => {
  it("viewer 不能编辑正文、保存或恢复版本；editor 可以", async () => {
    const task = finishedTask();
    const version = saveVersion(task.id, "v1", OWNER.name)!;
    expect(version).toBeTruthy();

    const anon = await reportPUT(
      jsonRequest("", "PUT", { report: "# 匿名" }),
      params(task.id)
    );
    expect(anon.status).toBe(401);

    const viewer = await cookieFor(VIEWER);
    const viewerEdit = await reportPUT(
      jsonRequest(viewer, "PUT", { report: "# viewer 改写" }),
      params(task.id)
    );
    expect(viewerEdit.status).toBe(403);

    const viewerSave = await versionsPOST(
      jsonRequest(viewer, "POST", { label: "viewer 版本" }),
      params(task.id)
    );
    expect(viewerSave!.status).toBe(403);

    const viewerRestore = await restorePOST(
      jsonRequest(viewer, "POST", {}),
      versionParams(task.id, version.id)
    );
    expect(viewerRestore!.status).toBe(403);

    const editor = await cookieFor(EDITOR);
    const editorEdit = await reportPUT(
      jsonRequest(editor, "PUT", { report: "# editor 补充" }),
      params(task.id)
    );
    expect(editorEdit.status).toBe(200);
    const editorSave = await versionsPOST(
      jsonRequest(editor, "POST", { label: "editor 版本" }),
      params(task.id)
    );
    expect(editorSave!.status).toBe(200);
  });

  it("分享配置只有任务所有者或 Owner/Admin 可改，成员只读", async () => {
    const task = finishedTask();
    const owner = await cookieFor(OWNER);
    const admin = await cookieFor(ADMIN);
    const editor = await cookieFor(EDITOR);
    const viewer = await cookieFor(VIEWER);

    const enable = await sharePUT(jsonRequest(owner, "PUT", { enabled: true }), params(task.id));
    expect(enable!.status).toBe(200);
    await expect(enable!.json()).resolves.toMatchObject({ shareConfig: { enabled: true } });

    const editorWrite = await sharePUT(
      jsonRequest(editor, "PUT", { enabled: false }),
      params(task.id)
    );
    expect(editorWrite!.status).toBe(403);

    const viewerWrite = await sharePUT(
      jsonRequest(viewer, "PUT", { enabled: false }),
      params(task.id)
    );
    expect(viewerWrite!.status).toBe(403);

    // 普通成员仍可查看当前配置（UI 需要展示「已开启/有密码」）
    const editorRead = await shareGET(getRequest(editor), params(task.id));
    expect(editorRead!.status).toBe(200);

    // 管理员即使不是任务所有者也能管理（对外暴露属管理决策）
    const adminWrite = await sharePUT(
      jsonRequest(admin, "PUT", { enabled: false }),
      params(task.id)
    );
    expect(adminWrite!.status).toBe(200);
  });
});

describe("报告评论的协作通知", () => {
  it("评论通知任务所有者，回复再通知被回复者，且不通知操作者", async () => {
    const task = finishedTask();
    const owner = await cookieFor(OWNER);
    const editor = await cookieFor(EDITOR);

    const commentRes = await commentsPOST(
      jsonRequest(editor, "POST", { text: "这里需要补一组对比数据", citeN: 1 }),
      params(task.id)
    );
    expect(commentRes!.status).toBe(200);
    const comment = (await commentRes!.json()).comment as { id: string };

    expect(listNotifications(OWNER.id).some((n) => n.title === "报告有新评论")).toBe(true);
    expect(listNotifications(EDITOR.id).some((n) => n.title === "报告有新评论")).toBe(false);

    const replyRes = await commentsPOST(
      jsonRequest(owner, "POST", { text: "已补充，见 2.1 节", parentId: comment.id }),
      params(task.id)
    );
    expect(replyRes!.status).toBe(200);

    expect(listNotifications(EDITOR.id).some((n) => n.title === "报告评论有新回复")).toBe(true);
    // 自己的评论/回复不会给自己发通知
    expect(listNotifications(OWNER.id).filter((n) => n.title === "报告有新评论")).toHaveLength(1);
    expect(listNotifications(OWNER.id).some((n) => n.title === "报告评论有新回复")).toBe(false);
  });
});
