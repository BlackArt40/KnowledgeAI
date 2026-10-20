import { describe, expect, it } from "vitest";
import type { AgentStep } from "@shared/agent/types";
import { inferDagEdges, inferDagNodes, roleLabel } from "./agent-dag";

const t = (k: string) => k;

describe("agent DAG inference", () => {
  it("maps steps onto the canonical role order", () => {
    const steps = [
      { role: "searcher", status: "done" },
      { role: "planner", status: "running" },
    ] as AgentStep[];
    const nodes = inferDagNodes(steps, ["planner", "searcher"], t);

    expect(nodes.map((n) => n.id)).toEqual(["planner", "searcher", "analyzer", "writer"]);
    expect(nodes[0]).toMatchObject({ status: "running", enabled: true, indegree: 0 });
    expect(nodes[1]).toMatchObject({ status: "done", enabled: true, indegree: 1 });
    expect(nodes[2]).toMatchObject({ status: "pending", enabled: false });
  });

  it("builds template edges with conditional expansion", () => {
    const edges = inferDagEdges("default");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]).toHaveProperty("from");
    expect(edges[0]).toHaveProperty("to");
  });

  it("falls back to Chinese labels for unknown roles", () => {
    expect(roleLabel(t, "planner")).toBe("page.agent.s40");
    expect(roleLabel(t, "writer")).toBe("page.agent.s43");
    expect(roleLabel(t, "other")).toBe("page.agent.s43");
  });
});
