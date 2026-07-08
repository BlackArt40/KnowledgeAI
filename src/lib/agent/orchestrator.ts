import { retrieve } from "@/lib/rag/retriever";
import { embed, cosine } from "@/lib/rag/embeddings";
import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";
import { notify } from "@/lib/notifications/store";
import { getKb } from "@/lib/kb/store";
import type {
  AgentTask,
  AgentStep,
  AgentCitation,
} from "./types";

import type { RetrievedChunk } from "@/lib/rag/types";

export interface AgentEvent {
  type: "step" | "done" | "error";
  step?: AgentStep;
  task?: AgentTask;
  message?: string;
}

const SECTIONS = [
  { id: "background", title: "背景概述" },
  { id: "status", title: "现状分析" },
  { id: "trends", title: "核心趋势" },
  { id: "challenges", title: "关键挑战" },
  { id: "outlook", title: "建议与展望" },
];

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

interface Ctx {
  outline: string[];
  citations: AgentCitation[];
  findings: { section: string; text: string; nums: number[] }[];
}

// Run a single agent: animate progress and emit updates, then produce result.
async function runStep(
  step: AgentStep,
  durationMs: number,
  emit: (e: AgentEvent) => Promise<void>,
  produce: () => string | Promise<string>
) {
  step.status = "running";
  step.startedAt = Date.now();
  step.progress = 0;
  await emit({ type: "step", step: { ...step } });
  const ticks = 10;
  for (let i = 1; i <= ticks; i++) {
    await sleep(durationMs / ticks);
    step.progress = Math.round((i / ticks) * 100);
    await emit({ type: "step", step: { ...step } });
  }
  step.result = await produce();
  step.status = "done";
  step.endedAt = Date.now();
  step.progress = 100;
  await emit({ type: "step", step: { ...step } });
}

// Main orchestrator. 🔌 Integration point: replace with LangGraph multi-agent
// graph + BullMQ worker; the event contract (step/done/error) stays the same.
export async function runTask(
  task: AgentTask,
  emit: (e: AgentEvent) => Promise<void>
) {
  const start = Date.now();
  const ctx: Ctx = { outline: [], citations: [], findings: [] };
  task.status = "running";
  task.steps = [];

  try {
    // ---- Planner ----
    const planner: AgentStep = {
      role: "planner",
      name: "规划 Agent",
      status: "pending",
      progress: 0,
      detail: "正在拆解研究主题…",
    };
    task.steps.push(planner);
    await runStep(planner, 1500, emit, () => {
      ctx.outline = SECTIONS.map((s) => s.title);
      planner.detail = `已拆解为 ${ctx.outline.length} 个研究子方向`;
      return `- 研究主题：${task.topic}\n` + ctx.outline.map((o) => `- ${o}`).join("\n");
    });

    // ---- Searcher (async retrieve) ----
    const searcher: AgentStep = {
      role: "searcher",
      name: "检索 Agent",
      status: "pending",
      progress: 0,
      detail: "正在检索相关资料…",
    };
    task.steps.push(searcher);

    // Pre-fetch chunks asynchronously (uses LLM embeddings if configured)
    const citeKey = new Map<string, number>();
    const sectionChunks = new Map<string, RetrievedChunk[]>();
    if (task.kbId) {
      const kb = getKb(task.kbId);
      const topK = kb?.settings.topK ?? 5;
      for (const s of SECTIONS) {
        const query = `${task.topic} ${s.title}`;
        const chunks = await retrieve(task.kbId, query, topK);
        sectionChunks.set(s.id, chunks);
      }
    }

    await runStep(searcher, 2200, emit, () => {
      const lines: string[] = [];
      for (const s of SECTIONS) {
        const chunks = sectionChunks.get(s.id) ?? [];
        const nums: number[] = [];
        for (const c of chunks.slice(0, 3)) {
          const key = `${c.docId}:${c.chunkIndex}`;
          let n = citeKey.get(key);
          if (!n) {
            n = ctx.citations.length + 1;
            citeKey.set(key, n);
            ctx.citations.push({
              n,
              title: c.docName,
              source: task.kbName ?? "知识库",
              snippet: c.text.slice(0, 140),
              score: c.score,
            });
          }
          if (!nums.includes(n)) nums.push(n);
        }
        lines.push(`- ${s.title}：命中 ${chunks.length} 条来源`);
      }
      searcher.detail = `共检索到 ${ctx.citations.length} 条引用来源`;
      return lines.join("\n");
    });

    // ---- Analyzer ----
    const analyzer: AgentStep = {
      role: "analyzer",
      name: "分析 Agent",
      status: "pending",
      progress: 0,
      detail: "正在提炼关键洞察…",
    };
    task.steps.push(analyzer);
    await runStep(analyzer, 2000, emit, () => {
      const lines: string[] = [];
      const used = new Set<string>();
      ctx.findings = SECTIONS.map((s) => {
        const chunks = sectionChunks.get(s.id) ?? [];
        const qv = embed(`${task.topic} ${s.title}`);
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
          const n = citeKey.get(pick.key);
          if (n) nums = [n];
        } else {
          text = `关于「${s.title}」，当前知识库资料有限，建议结合更多行业数据深入调研。`;
        }
        lines.push(`- ${s.title}：${text.slice(0, 46)}…`);
        return { section: s.title, text, nums };
      });
      analyzer.detail = `已提炼 ${ctx.findings.length} 条关键洞察`;
      return lines.join("\n");
    });

    // ---- Writer (LLM-enhanced if configured) ----
    const writer: AgentStep = {
      role: "writer",
      name: "写作 Agent",
      status: "pending",
      progress: 0,
      detail: `正在撰写${formatLabel(task.outputFormat)}…`,
    };
    task.steps.push(writer);
    await runStep(writer, 2000, emit, async () => {
      // Try LLM-enhanced report generation
      if (await isLLMEnabled()) {
        const llmReport = await generateLlmReport(task, ctx);
        if (llmReport) {
          task.report = llmReport;
          task.outline = ctx.outline;
          task.citations = ctx.citations;
          writer.detail = `${formatLabel(task.outputFormat)}已完成（LLM 生成）`;
          return task.report.split("\n").slice(0, 6).join("\n") + "\n…";
        }
      }
      // Fallback: extractive composition
      task.report = composeReport(task, ctx);
      task.outline = ctx.outline;
      task.citations = ctx.citations;
      writer.detail = `${formatLabel(task.outputFormat)}已完成`;
      return task.report.split("\n").slice(0, 6).join("\n") + "\n…";
    });

    task.status = "done";
    task.durationMs = Date.now() - start;
    notify(
      "agentDone",
      `Agent 调研报告已完成`,
      `「${task.topic}」报告已生成，耗时 ${Math.round(task.durationMs / 1000)} 秒。`,
      "/agent"
    );
    await emit({ type: "done", task });
  } catch (e) {
    task.status = "failed";
    await emit({
      type: "error",
      message: e instanceof Error ? e.message : "执行失败",
    });
  }
}

// LLM-enhanced report: ask the model to synthesize findings into a report.
async function generateLlmReport(task: AgentTask, ctx: Ctx): Promise<string | null> {
  const findings = ctx.findings
    .map((f, i) => `[${i + 1}] ${f.section}：${f.text}`)
    .join("\n");
  const sources = ctx.citations
    .map((c) => `[${c.n}] ${c.title}：${c.snippet}`)
    .join("\n");

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

function composeReport(task: AgentTask, ctx: Ctx): string {
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
  const ord = ["一", "二", "三", "四", "五"];
  findings.forEach((f, idx) => {
    md += `\n## ${ord[idx]}、${f.section}\n\n${f.text}${citeStr(f.nums)}\n`;
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
