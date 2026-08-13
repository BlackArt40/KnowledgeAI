// P6-4 unit tests: health/readiness (dependency checks + alert state machine).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  checkDb,
  checkRedis,
  checkLlm,
  checkReadiness,
  alertOnReadiness,
  readinessState,
  resetReadinessState,
  type DepStatus,
} from "./readiness";
import { listNotifications } from "@/lib/notifications/store";
import { seed as seedUsers, listUsers } from "@/lib/auth/store";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resetReadinessState();
  delete (globalThis as Record<string, unknown>).__KAI_NOTIF_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seedUsers();
});

function degraded(name: "db" | "redis" | "llm"): DepStatus {
  return { name, status: "degraded", detail: `${name} down` };
}
function okStatus(name: "db" | "redis" | "llm"): DepStatus {
  return { name, status: "ok" };
}

describe("skipped branches (demo mode)", () => {
  it("checkDb skips without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const r = await checkDb();
    expect(r.status).toBe("skipped");
  });

  it("checkRedis skips without REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", "");
    const r = await checkRedis();
    expect(r.status).toBe("skipped");
  });

  it("checkLlm skips without OPENAI_API_KEY", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const r = await checkLlm();
    expect(r.status).toBe("skipped");
  });

  it("checkReadiness aggregates skipped deps as ready (demo mode)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const deps = await checkReadiness();
    expect(deps.map((d) => d.name)).toEqual(["db", "redis", "llm"]);
    expect(deps.every((d) => d.status === "skipped")).toBe(true);
  });
});

describe("degraded branches (configured but unreachable)", () => {
  it("checkDb degrades when DATABASE_URL points at a dead port", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:59999/kai?connect_timeout=1");
    const r = await checkDb();
    expect(r.status).toBe("degraded");
    expect(r.detail).toBeTruthy();
  }, 15000);

  it("checkLlm degrades when the base URL is unreachable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-123");
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:59999/v1");
    const r = await checkLlm();
    expect(r.status).toBe("degraded");
    expect(r.detail).toBeTruthy();
  }, 10000);
});

describe("alert state machine", () => {
  it("alerts once on ok->degraded transition (notify owner+admin)", () => {
    expect(alertOnReadiness([okStatus("db"), okStatus("redis"), okStatus("llm")])).toBe(false);
    const alerted = alertOnReadiness([degraded("db"), okStatus("redis"), okStatus("llm")]);
    expect(alerted).toBe(true);
    expect(readinessState().degraded).toBe(true);
    expect(readinessState().degradedSince).not.toBeNull();
    // owner + admin got a securityAlert notification; non-admins did not
    for (const u of listUsers()) {
      const alerts = listNotifications(u.id).filter((n) => n.type === "securityAlert" && n.title.includes("依赖不可用"));
      if (u.role === "owner" || u.role === "admin") {
        expect(alerts.length).toBeGreaterThan(0);
      } else {
        expect(alerts).toHaveLength(0);
      }
    }
    // failures ring records the degraded deps
    expect(readinessState().failures[0].deps).toEqual(["db"]);
  });

  it("dedupes repeat alerts within the re-alert window", () => {
    alertOnReadiness([degraded("redis"), okStatus("db"), okStatus("llm")]);
    const before = listNotifications("usr_owner").length;
    expect(alertOnReadiness([degraded("redis"), okStatus("db"), okStatus("llm")])).toBe(false);
    expect(listNotifications("usr_owner").length).toBe(before);
  });

  it("sends a recovery notification on degraded->ok", () => {
    alertOnReadiness([degraded("llm"), okStatus("db"), okStatus("redis")]);
    const before = listNotifications("usr_owner").length;
    const recovered = alertOnReadiness([okStatus("llm"), okStatus("db"), okStatus("redis")]);
    expect(recovered).toBe(true);
    expect(readinessState().degraded).toBe(false);
    expect(readinessState().lastRecoveredAt).not.toBeNull();
    expect(listNotifications("usr_owner").length).toBe(before + 1);
    expect(listNotifications("usr_owner")[0].title).toContain("已恢复");
  });

  it("stays silent when nothing changes", () => {
    expect(alertOnReadiness([okStatus("db"), okStatus("redis"), okStatus("llm")])).toBe(false);
    expect(alertOnReadiness([okStatus("db"), okStatus("redis"), okStatus("llm")])).toBe(false);
    expect(readinessState().failures).toHaveLength(0);
  });
});
