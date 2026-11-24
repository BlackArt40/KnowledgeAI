export type ReadinessCheckState = "ok" | "degraded" | "skipped";

export type ReadinessCheck = {
  name: string;
  status: ReadinessCheckState;
  latencyMs?: number;
  detail?: string;
};

export type ReadinessPayload = {
  status: "ok" | "degraded";
  checks: ReadinessCheck[];
};

export type ReadinessPulse = {
  state: "online" | "degraded" | "offline";
  checks: ReadinessCheck[];
};

export function toReadinessPulse(payload: ReadinessPayload | null): ReadinessPulse {
  if (!payload) return { state: "offline", checks: [] };
  return {
    state: payload.status === "ok" ? "online" : "degraded",
    checks: payload.checks,
  };
}
