// StateGraph engine: a lightweight DAG executor that supports conditional
// branches, parallel node execution, and per-node enable/disable. This is
// the "LangGraph-style" core that orchestrator.ts uses to run agent workflows.
//
// Design:
// - Nodes are named functions that take a shared State and return a partial
//   state update.
// - Edges define the control flow. An edge can be unconditional (always taken)
//   or conditional (the `cond` function inspects state to pick the next node(s)).
// - Multiple outgoing unconditional edges = parallel fan-out. The engine awaits
//   all parallel branches before continuing to the join node.
// - A node can be disabled at runtime (skipped, state unchanged) via the
//   `enabled` set, allowing users to turn off specific stages.
//
// The engine is synchronous-in-order (topological) but parallel branches run
// concurrently via Promise.all. Cycle detection prevents infinite loops.

/** Shared mutable state passed through the graph. */
export type GraphState = Record<string, unknown>;

/** A node function: receives current state, returns a partial update. */
export type NodeFn<S extends GraphState = GraphState> = (
  state: S,
  emit?: (e: GraphEvent) => Promise<void>
) => Promise<Partial<S>>;

/** Edge condition: inspects state to decide which next node(s) to run. */
export type EdgeCond<S extends GraphState = GraphState> = (
  state: S
) => string | string[] | null; // node id, array of ids (parallel), or null (stop)

export interface NodeDef<S extends GraphState = GraphState> {
  id: string;
  /** Human-readable name for UI display. */
  name: string;
  /** Node function. Returns a partial state update (merged shallowly). */
  fn: NodeFn<S>;
  /** Optional: if this node should only run when a condition is met. */
  cond?: EdgeCond<S>;
}

export interface EdgeDef<S extends GraphState = GraphState> {
  from: string;
  to: string;
  /** If present, the edge is conditional: `cond(state)` decides whether to take it. */
  cond?: EdgeCond<S>;
}

export interface GraphEvent {
  type: "node_start" | "node_end" | "node_skip" | "branch" | "parallel_start" | "parallel_end" | "graph_end";
  nodeId?: string;
  nodeName?: string;
  detail?: string;
  /** For branch/parallel events: the chosen next node ids. */
  targets?: string[];
}

export interface StateGraph<S extends GraphState = GraphState> {
  nodes: Map<string, NodeDef<S>>;
  edges: EdgeDef<S>[];
  entry: string;
}

/** Builder for constructing a StateGraph fluently. */
export class GraphBuilder<S extends GraphState = GraphState> {
  private nodes = new Map<string, NodeDef<S>>();
  private edges: EdgeDef<S>[] = [];
  private entryNode: string | null = null;

  addNode(id: string, name: string, fn: NodeFn<S>): this {
    this.nodes.set(id, { id, name, fn });
    return this;
  }

  addEdge(from: string, to: string, cond?: EdgeCond<S>): this {
    this.edges.push({ from, to, cond });
    return this;
  }

  /** Conditional edge: shortcut for addEdge(from, to, cond). */
  addConditionalEdge(from: string, cond: EdgeCond<S>): this {
    // The cond returns the next node id(s) directly.
    this.edges.push({ from, to: "__cond__", cond });
    return this;
  }

  setEntry(id: string): this {
    this.entryNode = id;
    return this;
  }

  build(): StateGraph<S> {
    if (!this.entryNode) throw new Error("StateGraph: entry node not set");
    if (!this.nodes.has(this.entryNode)) throw new Error(`StateGraph: entry node "${this.entryNode}" not found`);
    return { nodes: this.nodes, edges: this.edges, entry: this.entryNode };
  }
}

/** Execute a StateGraph. Returns the final state after all reachable nodes run.
 *
 *  - `enabledNodes`: if provided, only nodes in this set run; others are skipped.
 *  - `emit`: optional event callback for progress tracking (node_start/end/skip,
 *    branch, parallel_start/end).
 *  - Cycle-safe: visited tracking prevents re-running a node in the same
 *    execution path (unless a new branch explicitly targets it).
 *  - Parallel: multiple unconditional outgoing edges fan-out concurrently.
 *  - Join: a node with multiple incoming edges waits for ALL predecessors
 *    to complete before running (barrier semantics).
 */
export async function runGraph<S extends GraphState = GraphState>(
  graph: StateGraph<S>,
  initialState: S,
  options?: {
    enabledNodes?: Set<string>;
    emit?: (e: GraphEvent) => Promise<void>;
    maxSteps?: number;
  }
): Promise<S> {
  const enabled = options?.enabledNodes;
  const emit = options?.emit ?? (async () => {});
  const maxSteps = options?.maxSteps ?? 50;
  let state = { ...initialState };
  let steps = 0;

  // Compute indegree for each node (for join/barrier detection).
  // Only unconditional edges count toward indegree — conditional edges are
  // mutually exclusive (only one fires), so they don't form a true barrier.
  const indegree = new Map<string, number>();
  for (const nodeId of graph.nodes.keys()) indegree.set(nodeId, 0);
  for (const edge of graph.edges) {
    if (edge.to !== "__cond__" && !edge.cond) {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
  }

  // Track how many predecessors have completed for each node.
  // A node runs when completedPredecessors == its indegree (barrier).
  const completedPred = new Map<string, number>();
  for (const nodeId of graph.nodes.keys()) completedPred.set(nodeId, 0);

  // Track which nodes have been executed (for cycle detection).
  const visited = new Set<string>();
  // Track which nodes have COMPLETED (fn finished + successors notified).
  // Distinct from `visited` which is set at runNode start.
  const completed = new Set<string>();

  // Resolvers for waiting nodes: when a predecessor completes, it resolves
  // the promise that a waiting successor is awaiting.
  const waiters = new Map<string, Array<() => void>>();

  async function runNode(nodeId: string): Promise<void> {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (steps++ > maxSteps) throw new Error(`StateGraph: exceeded maxSteps (${maxSteps}), possible cycle`);

    const node = graph.nodes.get(nodeId);
    if (!node) return;

    // Disabled node: skip, but still notify successors.
    if (enabled && !enabled.has(nodeId)) {
      await emit({ type: "node_skip", nodeId, nodeName: node.name });
      completed.add(nodeId); // skipped nodes are "completed" for join purposes
      await notifySuccessors(nodeId);
      return;
    }

    await emit({ type: "node_start", nodeId, nodeName: node.name });
    const update = await node.fn(state, emit);
    state = { ...state, ...update };
    completed.add(nodeId); // mark as completed BEFORE notifying successors
    await emit({ type: "node_end", nodeId, nodeName: node.name });
    await notifySuccessors(nodeId);
  }

  // Check if all predecessor source nodes of `target` have completed
  // (meaning no more predecessors will arrive — conditional branches that
  // didn't fire will never fire). This lets join nodes proceed when some
  // incoming branches are mutually exclusive and only one was taken.
  // Uses `completed` set (nodes whose fn has finished) NOT `visited` (which
  // is set at the START of runNode, before the fn completes).
  function allSourcesCompleted(target: string, justArrivedFrom: string): boolean {
    const incoming = graph.edges.filter((e) => e.to === target && !e.cond);
    if (incoming.length <= 1) return true;
    for (const edge of incoming) {
      if (edge.from === justArrivedFrom) continue;
      if (!completed.has(edge.from)) {
        // Predecessor hasn't completed. But has it been visited?
        // If visited (started running) but not completed, it's still running
        // and might arrive — wait.
        // If NOT visited, it might never be visited (conditional branch
        // didn't select it) — in that case, it will never arrive, so
        // we should proceed.
        if (visited.has(edge.from)) {
          return false; // still running, wait
        }
        // Not visited and not completed — will never arrive. Continue.
      }
    }
    return true;
  }

  async function notifySuccessors(fromId: string): Promise<void> {
    const outgoing = graph.edges.filter((e) => e.from === fromId);
    const conditional = outgoing.filter((e) => e.cond);
    const unconditional = outgoing.filter((e) => !e.cond);

    // Evaluate conditional edges: first non-null result wins.
    const targets: string[] = [];
    for (const edge of conditional) {
      const result = edge.cond!(state);
      if (result === null) continue;
      const ids = Array.isArray(result) ? result : [result];
      targets.push(...ids);
      await emit({ type: "branch", nodeId: fromId, targets: ids, detail: `branched to ${ids.join(", ")}` });
      break;
    }
    for (const edge of unconditional) {
      if (!targets.includes(edge.to)) targets.push(edge.to);
    }
    if (targets.length === 0) return;

    // Notify each target that a predecessor completed.
    const readyToRun: string[] = [];
    for (const t of targets) {
      const preds = (completedPred.get(t) ?? 0) + 1;
      completedPred.set(t, preds);
      const expected = indegree.get(t) ?? 1;
      // Check if all predecessors that will ever arrive have arrived.
      // A predecessor "arrives" if its source node has been visited and
      // chose this edge, or hasn't been visited yet (might arrive later).
      // If expected > 0 but some predecessors' source nodes are already
      // visited and didn't fire this edge (conditional branch), they
      // will never arrive — so we should run now.
      const allPredecessorsArrived = preds >= expected || allSourcesCompleted(t, fromId);
      if (allPredecessorsArrived) {
        readyToRun.push(t);
      } else {
        // Not ready yet (waiting for more predecessors). Wake any waiter.
        const resolvers = waiters.get(t);
        if (resolvers) {
          const resolve = resolvers.shift();
          if (resolve) resolve();
          if (resolvers.length === 0) waiters.delete(t);
        }
      }
    }

    if (readyToRun.length === 0) return;

    // Run ready nodes. If multiple, they're parallel (independent branches).
    if (readyToRun.length === 1) {
      await runNode(readyToRun[0]);
      return;
    }
    await emit({ type: "parallel_start", nodeId: fromId, targets: readyToRun, detail: `${readyToRun.length} parallel branches` });
    await Promise.all(readyToRun.map((t) => runNode(t)));
    await emit({ type: "parallel_end", nodeId: fromId, targets: readyToRun });
  }

  // Start from entry node.
  await runNode(graph.entry);
  await emit({ type: "graph_end" });
  return state;
}

/** Describe the graph as a list of edges for DAG visualization.
 *  Returns { nodes: [{id,name}], edges: [{from,to,conditional}] }. */
export function describeGraph<S extends GraphState = GraphState>(
  graph: StateGraph<S>
): { nodes: { id: string; name: string }[]; edges: { from: string; to: string; conditional: boolean }[] } {
  const nodes = Array.from(graph.nodes.values()).map((n) => ({ id: n.id, name: n.name }));
  const edges = graph.edges
    .filter((e) => e.to !== "__cond__")
    .map((e) => ({ from: e.from, to: e.to, conditional: !!e.cond }));
  // For conditional edges with to="__cond__", the actual targets are dynamic;
  // for visualization we include them with a special marker.
  const dynEdges = graph.edges
    .filter((e) => e.to === "__cond__")
    .map((e) => ({ from: e.from, to: "(conditional)", conditional: true }));
  return { nodes, edges: [...edges, ...dynEdges] };
}
