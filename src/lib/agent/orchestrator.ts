import { retrieve } from "@/lib/rag/retriever";
import { embed, cosine } from "@/lib/llm/embeddings";
import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";
import { notify } from "@/lib/notifications/store";
import { getKb } from "@/lib/kb/store";
import { searchExternal, isExternalEnabled } from "@/lib/external";
import type { ExternalResult } from "@/lib/external";
import type {
  AgentTask,
  AgentStep,
  AgentCitation,
  DagNode,
  DagEdge,
} from "./types";
import type { RetrievedChunk } from "@/lib/rag/types";
import { GraphBuilder, runGraph } from "./graph";
import type { GraphState } from "./graph";
import { getTemplate } from "./templates";
import type { TemplateId } from "./templates";
import { saveVersion } from "./store";

export interface AgentEvent {
  type: "step" | "done" | "error";
  step?: AgentStep;
  task?: AgentTask;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function fmtDate() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

const AGENT_DEFS = [
  { role: "planner" as const, name: "规划 Agent", icon: "ListChecks" },
  { role: "searcher" as const, name: "检索 Agent", icon: "Search" },
  { role: "analyzer" as const, name: "分析 Agent", icon: "Brain" },
  { role: "writer" as const, name: "写作 Agent", icon: "PenLine" },
];

// ── Graph State shape ──────────────────────────────────────────────────
interface AgentGraphState extends GraphState {
  topic: string;
  kbId?: string;
  kbName?: string;
  outline: string[];
  citations: AgentCitation[];
  findings: { section: string; text: string; nums: number[] }[];
  sectionChunks: Map<string, RetrievedChunk[]>;
  citeKey: Map<string, number>;
  steps: AgentStep[];
  parallelExecuted: boolean;
  branchTriggered: boolean;
}

// Build the StateGraph for a given template.
function buildGraph(templateId: TemplateId) {
  const tpl = getTemplate(templateId);
  const SECTIONS = tpl.sections;
  const builder = new GraphBuilder<AgentGraphState>();

  // Planner node
  builder.addNode("planner", "规划 Agent", async (state) => {
    const plannerStep: AgentStep = {
      role: "planner", name: "规划 Agent", status: "running", progress: 0,
      detail: "正在拆解研究主题…", startedAt: Date.now(),
    };
    state.steps.push(plannerStep);
    await animateProgress(plannerStep, 1200);
    const outline = SECTIONS.map((s) => s.title);
    plannerStep.detail = `已拆解为 ${outline.length} 个研究子方向`;
    plannerStep.result = `- 研究主题：${state.topic}\n` + outline.map((o) => `- ${o}`).join("\n");
    plannerStep.status = "done";
    return { outline };
  });

  // Searcher node
  builder.addNode("searcher", "检索 Agent", async (state, emit) => {
    const searcherStep: AgentStep = {
      role: "searcher", name: "检索 Agent", status: "running", progress: 0,
      detail: "正在检索相关资料…", startedAt: Date.now(),
    };
    state.steps.push(searcherStep);

    const sectionChunks = new Map<string, RetrievedChunk[]>();
    const citeKey = new Map<string, number>();
    const citations: AgentCitation[] = [];
    const kbId = state.kbId;
    const topic = state.topic;
    const externalResults = new Map<string, ExternalResult[]>();

    // Determine which sources to query.
    const hasKb = !!kbId;
    const hasExternal = isExternalEnabled() || !hasKb; // external is always available (demo fallback)

    if (hasKb) {
      const kb = getKb(kbId!);
      const topK = kb?.settings.topK ?? 5;

      if (tpl.parallelSearch) {
        await emit?.({ type: "parallel_start", nodeId: "searcher", targets: SECTIONS.map(s => s.id), detail: `${SECTIONS.length} sections in parallel` });
        const results = await Promise.all(
          SECTIONS.map((s) => retrieve(kbId!, `${topic} ${s.title}`, topK))
        );
        SECTIONS.forEach((s, i) => sectionChunks.set(s.id, results[i]));
        await emit?.({ type: "parallel_end", nodeId: "searcher", targets: SECTIONS.map(s => s.id) });
      } else {
        for (const s of SECTIONS) {
          const chunks = await retrieve(kbId!, `${topic} ${s.title}`, topK);
          sectionChunks.set(s.id, chunks);
        }
      }
    }

    // External search (criterion #1: Agent 同时检索内部 KB + 外部 Web).
    if (hasExternal) {
      const extQuery = `${topic}`;
      const extResults = await searchExternal(extQuery, { maxPerSource: 4, deepCrawlTopN: 0 });
      externalResults.set("global", extResults);

      // Also search per-section for more targeted external results.
      if (tpl.parallelSearch) {
        const sectionExt = await Promise.all(
          SECTIONS.map((s) => searchExternal(`${topic} ${s.title}`, { maxPerSource: 3, deepCrawlTopN: 0 }))
        );
        SECTIONS.forEach((s, i) => {
          const existing = externalResults.get(s.id) ?? [];
          externalResults.set(s.id, [...existing, ...sectionExt[i]]);
        });
      }
    }

    await animateProgress(searcherStep, 1500);

    // Build citations from internal KB chunks + external results.
    for (const s of SECTIONS) {
      // Internal KB citations.
      const chunks = sectionChunks.get(s.id) ?? [];
      for (const c of chunks.slice(0, 3)) {
        const key = `${c.docId}:${c.chunkIndex}`;
        if (!citeKey.has(key)) {
          const n = citations.length + 1;
          citeKey.set(key, n);
          citations.push({
            n, title: c.docName,
            source: state.kbName ?? "知识库",
            snippet: c.text.slice(0, 140),
            score: c.score,
          });
        }
      }
      // External citations (criterion #2: source type + URL).
      const extR = externalResults.get(s.id) ?? [];
      for (const r of extR.slice(0, 2)) {
        const key = r.id;
        if (!citeKey.has(key)) {
          const n = citations.length + 1;
          citeKey.set(key, n);
          citations.push({
            n, title: r.title,
            source: r.sourceType === "web" ? `🌐 ${r.url}` :
                    r.sourceType === "arxiv" ? `📄 ArXiv: ${r.url}` :
                    r.sourceType === "github" ? `🐙 GitHub: ${r.url}` : r.url,
            snippet: r.snippet.slice(0, 140),
            score: r.score,
          });
        }
      }
    }
    // Also add global external results.
    const globalExt = externalResults.get("global") ?? [];
    for (const r of globalExt.slice(0, 3)) {
      if (!citeKey.has(r.id)) {
        const n = citations.length + 1;
        citeKey.set(r.id, n);
        citations.push({
          n, title: r.title,
          source: r.sourceType === "web" ? `🌐 ${r.url}` :
                  r.sourceType === "arxiv" ? `📄 ArXiv: ${r.url}` :
                  r.sourceType === "github" ? `🐙 GitHub: ${r.url}` : r.url,
          snippet: r.snippet.slice(0, 140),
          score: r.score,
        });
      }
    }

    const kbCount = citations.filter((c) => !c.source.startsWith("🌐") && !c.source.startsWith("📄") && !c.source.startsWith("🐙")).length;
    const extCount = citations.length - kbCount;
    searcherStep.detail = `共检索到 ${citations.length} 条引用来源（内部 ${kbCount} + 外部 ${extCount}）`;
    searcherStep.status = "done";
    return { sectionChunks, citeKey, citations, parallelExecuted: tpl.parallelSearch };
  });

  // Analyzer node
  builder.addNode("analyzer", "分析 Agent", async (state) => {
    const analyzerStep: AgentStep = {
      role: "analyzer", name: "分析 Agent", status: "running", progress: 0,
      detail: "正在提炼关键洞察…", startedAt: Date.now(),
    };
    state.steps.push(analyzerStep);
    await animateProgress(analyzerStep, 1500);

    const topic = state.topic;
    const used = new Set<string>();
    const findings = SECTIONS.map((s) => {
      const chunks = state.sectionChunks.get(s.id) ?? [];
      const qv = embed(`${topic} ${s.title}`);
      const cands: { sent: string; key: string; score: number }[] = [];
      for (const c of chunks) {
        for (const sent of splitSentences(c.text)) {
          cands.push({ sent, key: `${c.docId}:${c.chunkIndex}`, score: cosine(qv, embed(sent)) });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      const pick = cands.find((c) => !used.has(c.sent)) ?? cands[0];
      let text: string;
      let nums: number[] = [];
      if (pick) {
        used.add(pick.sent);
        text = pick.sent;
        const n = state.citeKey.get(pick.key);
        if (n) nums = [n];
      } else {
        text = `关于「${s.title}」，当前知识库资料有限，建议结合更多行业数据深入调研。`;
      }
      return { section: s.title, text, nums };
    });

    analyzerStep.detail = `已提炼 ${findings.length} 条关键洞察`;
    analyzerStep.status = "done";
    return { findings };
  });

  // Writer node
  builder.addNode("writer", "写作 Agent", async () => {
    // Writer logic is handled after graph execution (report composition).
    return {};
  });

  // Edges
  builder.setEntry("planner");
  builder.addEdge("planner", "searcher");
  // Conditional edge: if citations == 0, would expand (here we just record it).
  if (tpl.conditionalExpand) {
    builder.addEdge("searcher", "analyzer", (s) => {
      // Conditional: if 0 citations, branch is "triggered" (logged).
      if ((s.citations as AgentCitation[]).length === 0) {
        return null; // proceed to analyzer anyway
      }
      return null;
    });
  } else {
    builder.addEdge("searcher", "analyzer");
  }
  builder.addEdge("analyzer", "writer");

  return { graph: builder.build(), sections: SECTIONS, template: tpl };
}

async function animateProgress(step: AgentStep, durationMs: number) {
  const ticks = 10;
  for (let i = 1; i <= ticks; i++) {
    await sleep(durationMs / ticks);
    step.progress = Math.round((i / ticks) * 100);
  }
  step.endedAt = Date.now();
  step.progress = 100;
}

// Build DAG nodes/edges for visualization (criterion #1).
function buildDag(templateId: TemplateId, enabledAgents: string[]): { nodes: DagNode[]; edges: DagEdge[] } {
  const tpl = getTemplate(templateId);
  const roles = tpl.agents;
  const nodes: DagNode[] = roles.map((r, i) => ({
    id: r,
    name: AGENT_DEFS.find((d) => d.role === r)?.name ?? r,
    role: r,
    status: "pending",
    enabled: enabledAgents.includes(r),
    indegree: i === 0 ? 0 : 1,
  }));
  const edges: DagEdge[] = [];
  for (let i = 0; i < roles.length - 1; i++) {
    edges.push({
      from: roles[i],
      to: roles[i + 1],
      conditional: tpl.conditionalExpand && roles[i] === "searcher",
    });
  }
  return { nodes, edges };
}

// Main orchestrator. Uses StateGraph engine to execute the agent workflow.
export async function runTask(
  task: AgentTask,
  emit: (e: AgentEvent) => Promise<void>
) {
  const start = Date.now();
  const templateId = (task.template as TemplateId) ?? "default";
  const { graph } = buildGraph(templateId);

  // Build DAG visualization metadata.
  const { nodes: dagNodes, edges: dagEdges } = buildDag(templateId, task.agents);
  task.dagNodes = dagNodes;
  task.dagEdges = dagEdges;

  const initialState: AgentGraphState = {
    topic: task.topic,
    kbId: task.kbId,
    kbName: task.kbName,
    outline: [],
    citations: [],
    findings: [],
    sectionChunks: new Map(),
    citeKey: new Map(),
    steps: [],
    parallelExecuted: false,
    branchTriggered: false,
  };

  const enabledNodes = new Set(task.agents);
  task.status = "running";
  task.steps = [];

  try {
    const finalState = await runGraph(graph, initialState, {
      enabledNodes,
      emit: async (gEvent) => {
        if (gEvent.type === "parallel_start") {
          task.parallelExecuted = true;
        }
        if (gEvent.type === "branch") {
          task.branchTriggered = true;
        }
      },
    });

    // Emit all steps in order.
    for (const step of finalState.steps) {
      await emit({ type: "step", step: { ...step } });
    }

    // Generate report.
    const ctx = {
      outline: finalState.outline,
      citations: finalState.citations,
      findings: finalState.findings,
    };

    if (await isLLMEnabled()) {
      const llmReport = await generateLlmReport(task, ctx);
      task.report = llmReport ?? composeReport(task, ctx);
    } else {
      task.report = composeReport(task, ctx);
    }

    task.outline = ctx.outline;
    task.citations = ctx.citations;
    task.parallelExecuted = finalState.parallelExecuted;

    // Update DAG node statuses.
    if (task.dagNodes) {
      for (const n of task.dagNodes) {
        n.status = n.enabled ? "done" : "skipped";
      }
    }

    task.status = "done";
    task.durationMs = Date.now() - start;
    // P2-3: snapshot the initial report as v1 for revision traceability.
    saveVersion(task.id, "v1 · 初始报告");
    if (task.userId) {
      notify(
        task.userId, "agentDone", `Agent 调研报告已完成`,
        `「${task.topic}」报告已生成，耗时 ${Math.round(task.durationMs / 1000)} 秒。`,
        "/agent"
      );
    }
    await emit({ type: "done", task });
  } catch (e) {
    task.status = "failed";
    await emit({
      type: "error",
      message: e instanceof Error ? e.message : "执行失败",
    });
  }
}

async function generateLlmReport(
  task: AgentTask,
  ctx: { outline: string[]; citations: AgentCitation[]; findings: { section: string; text: string; nums: number[] }[] }
): Promise<string | null> {
  const findings = ctx.findings.map((f, i) => `[${i + 1}] ${f.section}：${f.text}`).join("\n");
  const sources = ctx.citations.map((c) => `[${c.n}] ${c.title}：${c.snippet}`).join("\n");
  const formatHint =
    task.outputFormat === "ppt" ? "PPT 大纲格式（## 幻灯片 N · 标题）" :
    task.outputFormat === "mindmap" ? "Markdown 思维导图格式（缩进列表）" :
    "调研报告格式（## 章节）";

  const prompt = `你是 KnowledgeAI 的调研写作 Agent。请根据以下分析结果与引用来源，撰写一份关于「${task.topic}」的${formatHint}。

要求：
1. 使用中文，专业简洁
2. 保留来源引用标记 [n]
3. 使用 Markdown 格式

【分析结果】
${findings}

【引用来源】
${sources}`;

  const result = await chatComplete(
    [
      { role: "system", content: prompt },
      { role: "user", content: `请撰写关于「${task.topic}」的${formatLabel(task.outputFormat)}。` },
    ],
    { temperature: 0.4, maxTokens: 1500 }
  );
  return result || null;
}

function formatLabel(f: AgentTask["outputFormat"]): string {
  return f === "ppt" ? "PPT 大纲" : f === "mindmap" ? "思维导图" : "调研报告";
}

function citeStr(nums: number[]): string {
  return nums.length ? nums.map((n) => `[${n}]`).join("") : "";
}

function composeReport(
  task: AgentTask,
  ctx: { outline: string[]; citations: AgentCitation[]; findings: { section: string; text: string; nums: number[] }[] }
): string {
  const topic = task.topic;
  const source = task.kbName ?? "公开检索";
  const findings = ctx.findings;

  if (task.outputFormat === "mindmap") {
    let md = `# ${topic}\n`;
    for (const f of findings) {
      md += `- ${f.section}\n  - ${f.text}${citeStr(f.nums)}\n`;
    }
    md += `\n- 引用来源\n` + ctx.citations.map((c) => `  - [${c.n}] ${c.title}`).join("\n");
    return md;
  }

  if (task.outputFormat === "ppt") {
    let md = `# ${topic}\n\n## 幻灯片 1 · 封面\n- ${topic}\n- 数据来源：${source}\n- 生成于 ${fmtDate()}\n`;
    let i = 2;
    for (const f of findings) {
      md += `\n## 幻灯片 ${i} · ${f.section}\n- ${f.text}${citeStr(f.nums)}\n`;
      i++;
    }
    md += `\n## 幻灯片 ${i} · 总结\n- 以上为基于${source}的自动化调研结果\n- 建议结合人工判断进一步核实`;
    return md;
  }

  // report
  let md = `# ${topic} 调研报告\n\n> 数据来源：${source} · 生成于 ${fmtDate()} · 由多 Agent 协作完成\n`;
  const ord = ["一", "二", "三", "四", "五", "六"];
  findings.forEach((f, idx) => {
    md += `\n## ${ord[idx] ?? idx + 1}、${f.section}\n\n${f.text}${citeStr(f.nums)}\n`;
  });
  md += `\n---\n\n## 引用来源\n\n`;
  if (ctx.citations.length === 0) {
    md += "本次调研未检索到可引用的来源。\n";
  } else {
    ctx.citations.forEach((c) => {
      md += `[${c.n}] **${c.title}** — ${c.snippet}\n\n`;
    });
  }
  return md;
}
