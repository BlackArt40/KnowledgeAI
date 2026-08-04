"use client";

import * as React from "react";
import {
  ListChecks,
  Search,
  Brain,
  PenLine,
  Play,
  Loader2,
  Download,
  Copy,
  Share2,
  Check,
  Clock,
  Sparkles,
  ChevronRight,
  FileText,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/app/agent/markdown";
import { cn } from "@/lib/utils";
import type { AgentStep, AgentTask, DagNode, DagEdge, OutputFormat } from "@/lib/agent/types";
import { TEMPLATES } from "@/lib/agent/templates";
import type { TemplateId } from "@/lib/agent/templates";

const ROLE_ICON = { planner: ListChecks, searcher: Search, analyzer: Brain, writer: PenLine } as const;
const FORMAT_OPTS: { value: OutputFormat; label: string }[] = [
  { value: "report", label: "调研报告" },
  { value: "ppt", label: "PPT 大纲" },
  { value: "mindmap", label: "思维导图" },
];

interface KbLite { id: string; name: string }

export default function AgentPage() {
  const [kbs, setKbs] = React.useState<KbLite[]>([]);
  const [kbId, setKbId] = React.useState<string>(""); // "" = 公开检索
  const [topic, setTopic] = React.useState("2026 年 AI 工程师就业市场");
  const [format, setFormat] = React.useState<OutputFormat>("report");
  const [depth, setDepth] = React.useState(5);
  const [template, setTemplate] = React.useState<TemplateId>("default");
  const [enabledAgents, setEnabledAgents] = React.useState<string[]>(["planner", "searcher", "analyzer", "writer"]);

  const [running, setRunning] = React.useState(false);
  const [steps, setSteps] = React.useState<AgentStep[]>([]);
  const [task, setTask] = React.useState<AgentTask | null>(null);
  const [history, setHistory] = React.useState<AgentTask[]>([]);
  const [highlightN, setHighlightN] = React.useState<number | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/knowledge-base", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ kbs }) => setKbs(kbs));
    refreshHistory();
  }, []);

  function refreshHistory() {
    fetch("/api/agent/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ tasks }) => setHistory(tasks));
  }

  async function run() {
    if (!topic.trim() || running) return;
    setRunning(true);
    setTask(null);
    setSteps([]);
    setHighlightN(null);

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          kbId: kbId || undefined,
          outputFormat: format,
          maxSteps: depth,
          template,
          agents: enabledAgents,
        }),
      });
      if (!res.ok || !res.body) throw new Error();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === "step" && data.step) {
            setSteps((prev) => {
              const copy = [...prev];
              const i = copy.findIndex((s) => s.role === data.step.role);
              if (i >= 0) copy[i] = data.step;
              else copy.push(data.step);
              return copy;
            });
          } else if (data.type === "done" && data.task) {
            setTask(data.task);
            setSteps(data.task.steps);
            refreshHistory();
          }
        }
      }
    } catch {
      setSteps((prev) => prev);
    } finally {
      setRunning(false);
    }
  }

  async function viewHistory(id: string) {
    const res = await fetch(`/api/agent/tasks/${id}`, { cache: "no-store" });
    const { task } = await res.json();
    if (task) {
      setTask(task);
      setSteps(task.steps);
      setHighlightN(null);
    }
  }

  function downloadMd() {
    if (!task?.report) return;
    const blob = new Blob([task.report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${task.topic}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyText(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const showTimeline = running || steps.length > 0;
  const showReport = task?.report;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> Agent 调研
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          多 Agent 协作（规划→检索→分析→撰写），自动产出带引用的调研报告。
        </p>
      </div>

      {/* composer */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={2}
          placeholder="输入调研主题，例如：帮我调研 2026 年 AI 就业市场"
          className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          {/* KB */}
          <div className="min-w-[180px] flex-1">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">数据来源</label>
            <Select value={kbId} onValueChange={setKbId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="选择知识库" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">公开检索（模拟）</SelectItem>
                {kbs.map((kb) => (
                  <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* format */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">输出格式</label>
            <div className="flex rounded-lg border border-border bg-background p-0.5">
              {FORMAT_OPTS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFormat(f.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    format === f.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* depth */}
          <div className="min-w-[160px]">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              检索深度 <span className="text-primary">{depth}</span>
            </label>
            <Slider value={[depth]} onValueChange={(v) => setDepth(v[0])} min={3} max={10} step={1} className="w-[160px]" />
          </div>

          <Button variant="gradient" onClick={run} disabled={running || !topic.trim()} className="h-9">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "调研中…" : "开始调研"}
          </Button>
        </div>

        {/* template selector + agent combo */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          {/* Templates */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">调研模板</label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTemplate(t.id);
                    setFormat(t.defaultFormat);
                    setEnabledAgents(t.agents);
                  }}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    template === t.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                  title={t.description}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Agent toggles */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Agent 组合（可启用/禁用）</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(ROLE_ICON).map(([role, Icon]) => {
                const enabled = enabledAgents.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => {
                      setEnabledAgents((prev) =>
                        enabled ? prev.filter((r) => r !== role) : [...prev, role]
                      );
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                      enabled
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground opacity-50 hover:opacity-100"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {role === "planner" ? "规划" : role === "searcher" ? "检索" : role === "analyzer" ? "分析" : "写作"}
                    {enabled && <Check className="h-2.5 w-2.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* main: timeline + report */}
        <div className="space-y-6 lg:col-span-2">
          {showTimeline && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="h-4 w-4 text-primary" /> 执行过程
                {task?.parallelExecuted && (
                  <Badge variant="secondary" className="ml-2 gap-1 font-normal">
                    <Sparkles className="h-3 w-3" /> 并行
                  </Badge>
                )}
                {task?.branchTriggered && (
                  <Badge variant="secondary" className="ml-1 gap-1 font-normal">
                    <ChevronRight className="h-3 w-3" /> 条件分支
                  </Badge>
                )}
                {running && (
                  <Badge variant="default" className="ml-auto">
                    <Loader2 className="h-3 w-3 animate-spin" /> 进行中
                  </Badge>
                )}
              </h3>
              {/* DAG workflow visualization (criterion #1) */}
              {(task?.dagNodes ?? (steps.length > 0 ? inferDagFromSteps(steps, enabledAgents) : null)) && (
                <WorkflowDag
                  nodes={task?.dagNodes ?? inferDagFromSteps(steps, enabledAgents)!}
                  edges={task?.dagEdges ?? inferDagEdges(template)}
                />
              )}
              <Timeline steps={steps} />
            </div>
          )}

          {showReport ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" /> 调研结果
                </h3>
                <div className="ml-auto flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => copyText(task!.report!, "report")}>
                    {copied === "report" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    复制
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyText(`${window.location.origin}/r/${task!.id}`, "share")}>
                    {copied === "share" ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                    分享
                  </Button>
                  <Button variant="gradient" size="sm" onClick={downloadMd}>
                    <Download className="h-3.5 w-3.5" /> 导出 MD
                  </Button>
                </div>
              </div>
              <Markdown text={showReport} onCite={setHighlightN} />
            </div>
          ) : (
            !showTimeline && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </span>
                <p className="mt-3 text-sm font-medium">输入主题，开始一次自动化调研</p>
                <p className="mt-1 text-xs text-muted-foreground">多 Agent 将协作规划、检索、分析并撰写报告</p>
              </div>
            )
          )}
        </div>

        {/* sidebar: history + citations */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-muted-foreground" /> 历史任务
            </h3>
            {history.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无历史任务</p>
            ) : (
              <div className="space-y-1">
                {history.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => viewHistory(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      task?.id === t.id ? "bg-primary/10 text-primary" : "hover:bg-accent"
                    )}
                  >
                    <span className="line-clamp-1 flex-1 text-xs font-medium">{t.topic}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Search className="h-4 w-4 text-muted-foreground" /> 引用来源
              {task && <Badge variant="secondary" className="ml-auto">{task.citations.length}</Badge>}
            </h3>
            {!task || task.citations.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">调研引用将显示在此处</p>
            ) : (
              <div className="space-y-2">
                {task.citations.map((c) => (
                  <div
                    key={c.n}
                    className={cn(
                      "rounded-lg border p-2.5 transition-colors",
                      highlightN === c.n ? "border-primary ring-1 ring-primary/30" : "border-border"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">{c.n}</span>
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="line-clamp-1 text-xs font-medium">{c.title}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{c.snippet}</p>
                    <span className="mt-1 block text-[10px] text-muted-foreground">{c.source} · 相似度 {(c.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {task?.durationMs && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> 耗时 {(task.durationMs / 1000).toFixed(1)}s · {task.outputFormat === "ppt" ? "PPT 大纲" : task.outputFormat === "mindmap" ? "思维导图" : "调研报告"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ steps }: { steps: AgentStep[] }) {
  const order = ["planner", "searcher", "analyzer", "writer"];
  const sorted = [...steps].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return (
    <div className="space-y-1">
      {sorted.map((step, i) => {
        const Icon = ROLE_ICON[step.role];
        const active = step.status === "running";
        const done = step.status === "done";
        const skipped = step.status === "skipped";
        return (
          <div key={step.role} className="relative flex gap-3 pb-4 last:pb-0">
            {i < sorted.length - 1 && (
              <span className="absolute left-[15px] top-9 h-[calc(100%-1.5rem)] w-px bg-border" />
            )}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary bg-card text-primary" : skipped ? "border-dashed border-border bg-card text-muted-foreground opacity-50" : "border-border bg-card text-muted-foreground"
              )}
            >
              {done ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm font-medium", skipped && "line-through opacity-50")}>{step.name}</span>
                {active && <span className="text-xs text-primary">{step.progress}%</span>}
                {done && <span className="text-xs text-success">已完成</span>}
                {skipped && <span className="text-xs text-muted-foreground">已跳过</span>}
              </div>
              {active && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-brand-gradient transition-all duration-300" style={{ width: `${step.progress}%` }} />
                </div>
              )}
              {step.detail && <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>}
              {step.result && (done || active) && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {step.result}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Infer DAG nodes from step state when task.dagNodes is not yet available
// (during streaming before done event).
function inferDagFromSteps(steps: AgentStep[], enabledAgents: string[]): DagNode[] {
  const order = ["planner", "searcher", "analyzer", "writer"];
  return order.map((r, i) => {
    const step = steps.find((s) => s.role === r);
    return {
      id: r,
      name: r === "planner" ? "规划" : r === "searcher" ? "检索" : r === "analyzer" ? "分析" : "写作",
      role: r as DagNode["role"],
      status: step ? (step.status as DagNode["status"]) : "pending",
      enabled: enabledAgents.includes(r),
      indegree: i === 0 ? 0 : 1,
    };
  });
}

function inferDagEdges(template: TemplateId): DagEdge[] {
  const tpl = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0];
  const roles = tpl.agents;
  const edges: DagEdge[] = [];
  for (let i = 0; i < roles.length - 1; i++) {
    edges.push({
      from: roles[i],
      to: roles[i + 1],
      conditional: tpl.conditionalExpand && roles[i] === "searcher",
    });
  }
  return edges;
}

// DAG workflow visualization component (criterion #1: Agent 工作流可视化展示).
// Renders nodes as connected pills in a horizontal flow with edges as arrows.
function WorkflowDag({ nodes, edges }: { nodes: DagNode[]; edges: DagEdge[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/20 p-3">
      <span className="mr-1 text-[10px] font-medium text-muted-foreground">DAG</span>
      {nodes.map((node, i) => {
        const Icon = ROLE_ICON[node.role];
        const isDone = node.status === "done";
        const isRunning = node.status === "running";
        const isSkipped = node.status === "skipped";
        // Find edge to next node
        const edge = edges.find((e) => e.from === node.id);
        return (
          <React.Fragment key={node.id}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors",
                isDone ? "border-primary bg-primary/15 text-primary" :
                isRunning ? "border-primary bg-card text-primary" :
                isSkipped ? "border-dashed border-border bg-card text-muted-foreground opacity-40" :
                "border-border bg-card text-muted-foreground"
              )}
              title={node.enabled ? undefined : "已禁用"}
            >
              <Icon className="h-3 w-3" />
              {node.name}
              {isDone && <Check className="h-2.5 w-2.5" />}
              {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            </span>
            {edge && i < nodes.length - 1 && (
              <span className="inline-flex items-center gap-0.5">
                <span className={cn("text-[10px]", edge.conditional ? "text-amber-500" : "text-muted-foreground")}>
                  {edge.conditional ? "?" : "→"}
                </span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
