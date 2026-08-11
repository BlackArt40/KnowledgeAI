// P6-3 unit tests: auth/store (in-memory user store on globalThis).
import { describe, it, expect, beforeEach } from "vitest";
import {
  seed,
  findUserByEmail,
  getUserById,
  verifyCredentials,
  createUser,
  listUsers,
  updateUser,
  setUserStatus,
  updateUserPlan,
  deleteUser,
  sanitize,
  DEMO_PASSWORD,
} from "./store";

beforeEach(() => {
  // Fresh store per test (globalThis-backed, HMR-safe pattern).
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seed();
});

describe("seed + lookup", () => {
  it("seeds 4 demo users with all four roles", () => {
    const users = listUsers();
    expect(users).toHaveLength(4);
    expect(new Set(users.map((u) => u.role))).toEqual(new Set(["owner", "admin", "editor", "viewer"]));
  });

  it("findUserByEmail is case-insensitive and getUserById resolves", () => {
    expect(findUserByEmail("OWNER@knowledgeai.dev")?.id).toBe("usr_owner");
    expect(getUserById("usr_owner")?.email).toBe("owner@knowledgeai.dev");
    expect(findUserByEmail("nobody@nowhere.dev")).toBeNull();
    expect(getUserById("missing")).toBeNull();
  });

  it("verifies the demo password and rejects wrong ones", async () => {
    expect(await verifyCredentials("editor@knowledgeai.dev", DEMO_PASSWORD)).not.toBeNull();
    expect(await verifyCredentials("editor@knowledgeai.dev", "wrong")).toBeNull();
    expect(await verifyCredentials("unknown@x.dev", DEMO_PASSWORD)).toBeNull();
  });
});

describe("createUser / updateUser", () => {
  it("creates a user with default editor role", async () => {
    const u = await createUser("新人", "new@x.dev", "password1");
    expect((u as { id?: string }).id).toBeDefined();
    expect(findUserByEmail("new@x.dev")?.role).toBe("editor");
  });

  it("rejects duplicate emails", async () => {
    const u = await createUser("Dup", "owner@knowledgeai.dev", "password1");
    expect((u as { error?: string }).error).toBe("该邮箱已被注册");
  });

  it("updates name / locale and rejects bad locale", async () => {
    const updated = await updateUser("usr_owner", { name: "新名字", locale: "en" });
    expect((updated as { name?: string }).name).toBe("新名字");
    const bad = await updateUser("usr_owner", { locale: "fr" });
    expect((bad as { error?: string }).error).toBe("不支持的语言");
  });

  it("changes password only with the correct current password", async () => {
    const noCur = await updateUser("usr_owner", { newPassword: "newpassword1" });
    expect((noCur as { error?: string }).error).toBe("修改密码需提供当前密码");
    const badCur = await updateUser("usr_owner", { currentPassword: "nope", newPassword: "newpassword1" });
    expect((badCur as { error?: string }).error).toBe("当前密码不正确");
    const ok = await updateUser("usr_owner", { currentPassword: DEMO_PASSWORD, newPassword: "newpassword1" });
    expect(ok).not.toHaveProperty("error");
    expect(await verifyCredentials("owner@knowledgeai.dev", "newpassword1")).not.toBeNull();
    expect(await verifyCredentials("owner@knowledgeai.dev", DEMO_PASSWORD)).toBeNull();
  });

  it("returns error for unknown users", async () => {
    const u = await updateUser("missing", { name: "X" });
    expect((u as { error?: string }).error).toBe("用户不存在");
  });
});

describe("admin ops", () => {
  it("setUserStatus bans / unbans", () => {
    expect(setUserStatus("usr_viewer", "banned")?.status).toBe("banned");
    expect(getUserById("usr_viewer")?.status).toBe("banned");
    expect(setUserStatus("missing", "banned")).toBeNull();
  });

  it("updateUserPlan upgrades plans", () => {
    expect(updateUserPlan("usr_viewer", "pro")?.plan).toBe("pro");
    expect(updateUserPlan("missing", "pro")).toBeNull();
  });

  it("deleteUser removes and returns false for unknown", () => {
    expect(deleteUser("usr_viewer")).toBe(true);
    expect(findUserByEmail("viewer@knowledgeai.dev")).toBeNull();
    expect(deleteUser("missing")).toBe(false);
  });

  it("sanitize strips the password hash", () => {
    const user = getUserById("usr_owner")!;
    const clean = sanitize(user);
    expect(clean).not.toHaveProperty("passwordHash");
    expect(clean.email).toBe("owner@knowledgeai.dev");
  });
});
