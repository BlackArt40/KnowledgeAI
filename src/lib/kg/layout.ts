// P7-3: knowledge-graph force layout via d3-force (replaced the hand-rolled
// repulsion/spring simulation in 2026-08, P7-5). Deterministic for a given
// input snapshot: initial positions are fixed (circle placement) and the
// simulation runs synchronously via tick() - SSR and client hydrate to the
// same coordinates, no flicker.
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

export interface GraphNodeData {
  id: string;
  label: string;
  type: string;
  mentions: number;
  docCount: number;
}
export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface LayoutNode extends GraphNodeData {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

const W = 900;
const H = 560;
const MAX_NODES = 60;
const MAX_EDGES = 120;
/**
 * Synchronous simulation ticks. d3-force's alpha decays monotonically, so
 * extra ticks only nudge nodes closer to equilibrium - 300 is far past the
 * point where movement is measurable for <=60 nodes.
 */
const ITERATIONS = 300;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Compute node positions + edge endpoints for a graph snapshot.
 * Nodes are capped by mention count, edges by weight (same policy as the
 * original implementation); edges reference entity LABELS (API shape).
 */
export function computeGraphLayout(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[]
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const cappedNodes = [...nodes].sort((a, b) => b.mentions - a.mentions).slice(0, MAX_NODES);
  const labelSet = new Set(cappedNodes.map((n) => n.label));
  const cappedEdges = edges
    .filter((e) => labelSet.has(e.source) && labelSet.has(e.target))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_EDGES);

  interface SimNode extends SimulationNodeDatum {
    id: string;
    label: string;
    type: string;
    mentions: number;
    docCount: number;
  }
  interface SimLink extends SimulationLinkDatum<SimNode> {
    id: string;
    weight: number;
  }

  const simNodes: SimNode[] = cappedNodes.map((n, i) => {
    const angle = (i / Math.max(1, cappedNodes.length)) * Math.PI * 2;
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      mentions: n.mentions,
      docCount: n.docCount,
      x: W / 2 + Math.cos(angle) * (W / 3),
      y: H / 2 + Math.sin(angle) * (H / 3),
      vx: 0,
      vy: 0,
    };
  });
  const simLinks: SimLink[] = cappedEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    weight: e.weight,
  }));

  const simulation = forceSimulation(simNodes)
    .force("charge", forceManyBody().strength(-300).distanceMax(500))
    .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.label).distance(110).strength(0.4))
    .force("center", forceCenter(W / 2, H / 2))
    .force("x", forceX(W / 2).strength(0.02))
    .force("y", forceY(H / 2).strength(0.02))
    .stop();
  simulation.tick(ITERATIONS);

  // Clamp inside the viewBox so labels stay visible; forceLink rewrote
  // source/target into node references - map back to labels for rendering.
  const outNodes: LayoutNode[] = simNodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    mentions: n.mentions,
    docCount: n.docCount,
    x: clamp(n.x ?? W / 2, 30, W - 30),
    y: clamp(n.y ?? H / 2, 30, H - 30),
    vx: n.vx ?? 0,
    vy: n.vy ?? 0,
  }));
  const outEdges: LayoutEdge[] = simLinks.map((l) => ({
    id: l.id,
    source: (l.source as SimNode).label,
    target: (l.target as SimNode).label,
    weight: l.weight,
  }));
  return { nodes: outNodes, edges: outEdges };
}
