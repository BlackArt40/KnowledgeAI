// P7-5 adapter tests: kg/layout (d3-force graph layout). The layout must be
// deterministic for a snapshot (SSR/client hydrate to the same coordinates),
// respect node/edge caps, clamp inside the viewBox, and keep label references
// on edges (the SVG renderer resolves positions by label).
import { describe, it, expect } from "vitest";
import { computeGraphLayout, type GraphNodeData, type GraphEdgeData } from "./layout";

function node(id: string, label: string, mentions = 1): GraphNodeData {
  return { id, label, type: "concept", mentions, docCount: 1 };
}
function edge(id: string, source: string, target: string, weight = 1): GraphEdgeData {
  return { id, source, target, type: "related", weight };
}

const nodes = [node("n1", "甲", 5), node("n2", "乙", 3), node("n3", "丙", 1)];
const edges = [edge("e1", "甲", "乙", 2), edge("e2", "乙", "丙", 1)];

describe("computeGraphLayout", () => {
  it("lays out every node with finite, in-bounds coordinates", () => {
    const { nodes: out } = computeGraphLayout(nodes, edges);
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(30);
      expect(n.x).toBeLessThanOrEqual(900 - 30);
      expect(n.y).toBeGreaterThanOrEqual(30);
      expect(n.y).toBeLessThanOrEqual(560 - 30);
    }
  });

  it("keeps label references on edges (source/target resolved by label)", () => {
    const { edges: out } = computeGraphLayout(nodes, edges);
    expect(out).toHaveLength(2);
    const labels = new Set(nodes.map((n) => n.label));
    for (const e of out) {
      expect(labels.has(e.source)).toBe(true);
      expect(labels.has(e.target)).toBe(true);
    }
  });

  it("is deterministic for the same snapshot", () => {
    const a = computeGraphLayout(nodes, edges);
    const b = computeGraphLayout(nodes, edges);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(a.edges.map((e) => [e.source, e.target])).toEqual(b.edges.map((e) => [e.source, e.target]));
  });

  it("caps nodes by mentions (60) and edges by weight (120)", () => {
    const many = Array.from({ length: 80 }, (_, i) => node(`n${i}`, `标签${i}`, 100 - i));
    const manyEdges = Array.from({ length: 200 }, (_, i) => edge(`e${i}`, `标签${i % 60}`, `标签${(i + 1) % 60}`, 200 - i));
    const { nodes: outNodes, edges: outEdges } = computeGraphLayout(many, manyEdges);
    expect(outNodes).toHaveLength(60);
    expect(outEdges).toHaveLength(120);
    // highest-mention nodes survive the cap
    expect(outNodes[0].label).toBe("标签0");
  });

  it("drops edges whose endpoints were capped away", () => {
    const { edges: out } = computeGraphLayout(
      [node("a", "甲", 10)],
      [edge("e1", "甲", "乙", 5), edge("e2", "甲", "甲", 1)]
    );
    expect(out).toHaveLength(1); // e1 references 乙 which was capped -> dropped
    expect(out[0].source).toBe("甲");
  });

  it("handles empty input", () => {
    const { nodes: outN, edges: outE } = computeGraphLayout([], []);
    expect(outN).toEqual([]);
    expect(outE).toEqual([]);
  });
});
