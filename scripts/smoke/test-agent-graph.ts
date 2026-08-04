// @ts-nocheck
// P1-2-1 acceptance verification: StateGraph engine + DAG visualization + templates.
// Run: npx tsx scripts/smoke/test-agent-graph.ts
async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. StateGraph engine: basic sequential execution ──────────────────
  const { GraphBuilder, runGraph, describeGraph } = await import("../../src/lib/agent/graph");

  const log: string[] = [];
  const builder = new GraphBuilder();
  builder.addNode("a", "Node A", async (s) => { log.push("a"); return { visited: [...(s.visited ?? []), "a"] }; });
  builder.addNode("b", "Node B", async (s) => { log.push("b"); return { visited: [...(s.visited ?? []), "b"] }; });
  builder.addNode("c", "Node C", async (s) => { log.push("c"); return { visited: [...(s.visited ?? []), "c"] }; });
  builder.setEntry("a");
  builder.addEdge("a", "b");
  builder.addEdge("b", "c");
  const graph = builder.build();

  const result = await runGraph(graph, { visited: [] });
  check("graph: sequential execution order a→b→c", JSON.stringify(log) === JSON.stringify(["a", "b", "c"]), JSON.stringify(log));
  check("graph: state merged across nodes", (result.visited as string[]).length === 3, JSON.stringify(result.visited));

  // ── 2. Parallel execution (criterion #2: parallel) ───────────────────
  const log2: string[] = [];
  const builder2 = new GraphBuilder();
  builder2.addNode("start", "Start", async () => { return {}; });
  builder2.addNode("p1", "Parallel 1", async () => {
    await new Promise(r => setTimeout(r, 50));
    log2.push("p1");
    return { p1done: true };
  });
  builder2.addNode("p2", "Parallel 2", async () => {
    await new Promise(r => setTimeout(r, 30));
    log2.push("p2");
    return { p2done: true };
  });
  builder2.addNode("join", "Join", async () => { log2.push("join"); return {}; });
  builder2.setEntry("start");
  builder2.addEdge("start", "p1");
  builder2.addEdge("start", "p2"); // two unconditional edges = parallel fan-out
  builder2.addEdge("p1", "join");
  builder2.addEdge("p2", "join");
  const graph2 = builder2.build();

  const events: string[] = [];
  const result2 = await runGraph(graph2, {}, {
    emit: async (e) => {
      if (e.type === "parallel_start") events.push("parallel_start");
      if (e.type === "parallel_end") events.push("parallel_end");
    },
  });
  check("graph: parallel branches started", events.includes("parallel_start"));
  check("graph: parallel branches ended", events.includes("parallel_end"));
  check("graph: both parallel nodes ran", log2.includes("p1") && log2.includes("p2"));
  check("graph: join ran after both", log2[log2.length - 1] === "join", `last was ${log2[log2.length - 1]}`);
  // p2 (30ms) should finish before p1 (50ms) in parallel, but both before join.
  const p2Idx = log2.indexOf("p2");
  const p1Idx = log2.indexOf("p1");
  const joinIdx = log2.indexOf("join");
  check("graph: join runs after both parallel (criterion #2)", joinIdx > p1Idx && joinIdx > p2Idx, `p1=${p1Idx} p2=${p2Idx} join=${joinIdx}`);

  // ── 3. Conditional branches (criterion #2: conditional) ──────────────
  const log3: string[] = [];
  const builder3 = new GraphBuilder();
  builder3.addNode("check", "Check", async () => { return { score: 75 }; });
  builder3.addNode("high", "High Path", async () => { log3.push("high"); return { path: "high" }; });
  builder3.addNode("low", "Low Path", async () => { log3.push("low"); return { path: "low" }; });
  builder3.addNode("done", "Done", async () => { log3.push("done"); return {}; });
  builder3.setEntry("check");
  builder3.addEdge("check", "high", (s) => (s.score >= 60 ? "high" : null));
  builder3.addEdge("check", "low", (s) => (s.score < 60 ? "low" : null));
  builder3.addEdge("high", "done");
  builder3.addEdge("low", "done");
  const graph3 = builder3.build();

  const result3 = await runGraph(graph3, { score: 75 });
  check("graph: conditional branch selects correct path (score=75 → high)", log3.includes("high") && !log3.includes("low"), JSON.stringify(log3));
  check("graph: condition branches to done after high", log3[log3.length - 1] === "done");

  // Re-run with low score.
  const log3b: string[] = [];
  const builder3b = new GraphBuilder();
  builder3b.addNode("check", "Check", async () => { return { score: 40 }; });
  builder3b.addNode("high", "High Path", async () => { log3b.push("high"); return {}; });
  builder3b.addNode("low", "Low Path", async () => { log3b.push("low"); return {}; });
  builder3b.addNode("done", "Done", async () => { log3b.push("done"); return {}; });
  builder3b.setEntry("check");
  builder3b.addEdge("check", "high", (s) => (s.score >= 60 ? "high" : null));
  builder3b.addEdge("check", "low", (s) => (s.score < 60 ? "low" : null));
  builder3b.addEdge("high", "done");
  builder3b.addEdge("low", "done");
  const graph3b = builder3b.build();
  await runGraph(graph3b, { score: 40 });
  check("graph: conditional branch selects low path (score=40 → low)", log3b.includes("low") && !log3b.includes("high"), JSON.stringify(log3b));

  // ── 4. Node disable/skip (criterion: agent configurable) ────────────
  const log4: string[] = [];
  const builder4 = new GraphBuilder();
  builder4.addNode("a", "A", async () => { log4.push("a"); return {}; });
  builder4.addNode("b", "B", async () => { log4.push("b"); return {}; });
  builder4.addNode("c", "C", async () => { log4.push("c"); return {}; });
  builder4.setEntry("a");
  builder4.addEdge("a", "b");
  builder4.addEdge("b", "c");
  const graph4 = builder4.build();

  const skipEvents: string[] = [];
  await runGraph(graph4, {}, {
    enabledNodes: new Set(["a", "c"]), // b disabled
    emit: async (e) => {
      if (e.type === "node_skip") skipEvents.push(e.nodeId!);
    },
  });
  check("graph: disabled node skipped", !log4.includes("b") && log4.includes("a") && log4.includes("c"));
  check("graph: node_skip event emitted for disabled node", skipEvents.includes("b"));

  // ── 5. Templates (criterion #3: ≥3 preset templates) ─────────────────
  const { TEMPLATES } = await import("../../src/lib/agent/templates");
  check("templates: at least 3 presets (criterion #3)", TEMPLATES.length >= 3, `got ${TEMPLATES.length}`);
  check("templates: has competitive", TEMPLATES.some(t => t.id === "competitive"));
  check("templates: has tech-selection", TEMPLATES.some(t => t.id === "tech-selection"));
  check("templates: has market", TEMPLATES.some(t => t.id === "market"));
  check("templates: each has ≥4 sections", TEMPLATES.every(t => t.sections.length >= 4));
  check("templates: each has 4 agents", TEMPLATES.every(t => t.agents.length === 4));
  check("templates: competitive uses parallel search", TEMPLATES.find(t => t.id === "competitive")?.parallelSearch === true);
  check("templates: competitive uses conditional expand", TEMPLATES.find(t => t.id === "competitive")?.conditionalExpand === true);

  // ── 6. DAG visualization (criterion #1: workflow visualization) ──────
  const { describeGraph: dg } = await import("../../src/lib/agent/graph");
  const desc = dg(graph);
  check("dag: describeGraph returns nodes", desc.nodes.length === 3);
  check("dag: describeGraph returns edges", desc.edges.length >= 2);
  check("dag: edges have from/to", desc.edges.every(e => e.from && e.to));

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
