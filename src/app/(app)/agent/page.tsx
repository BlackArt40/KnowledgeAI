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
  FileDown,
  Presentation,
  Network,
  Pencil,
  Save,
  X,
  MessageSquare,
  GitBranch,
  Trash2,
  RotateCcw,
  ChevronDown,
  Plus,
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
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/components/app/agent/markdown";
import { cn } from "@/lib/utils";
import type {
  AgentStep,
  AgentTask,
  DagNode,
  DagEdge,
  OutputFormat,
  ExportFormat,
  ReportVersion,
  Comment,
  ShareConfig,
  AgentCitation,
} from "@/lib/agent/types";
import { diffLines, type DiffLine } from "@/lib/agent/diff";
import { TEMPLATES } from "@/lib/agent/templates";
import type { TemplateId } from "@/lib/agent/templates";

const ROLE_ICON = { planner: ListChecks, searcher: Search, analyzer: Brain, writer: PenLine } as const;
const FORMAT_OPTS: { value: OutputFormat; label: string }[] = [
  { value: "report", label: "调研报告" },
  { value: "ppt", label: "PPT 大纲" },
  { value: "mindmap", label: "思维导图" },
];

const EXPORT_ITEMS: { value: ExportFormat; label: string; icon: typeof FileText }[] = [
  { value: "md", label: "Markdown (.md)", icon: FileText },
  { value: "pdf", label: "PDF (打印另存)", icon: FileDown },
  { value: "pptx", label: "PPTX 幻灯片", icon: Presentation },
  { value: "mindmap", label: "思维导图 (.opml)", icon: Network },
];

interface KbLite { id: string; name: string }

// 公开检索的哨兵值。Radix Select 把 SelectItem 的 value="" 当作"未选中"而显示 placeholder，
// 故用非空哨兵代表公开检索，提交 API 时再转回 undefined（后端据此走公开检索链路）。
const PUBLIC_SEARCH = "public";

export default function AgentPage() {
  const [kbs, setKbs] = React.useState<KbLite[]>([]);
  const [kbId, setKbId] = React.useState<string>(PUBLIC_SEARCH); // PUBLIC_SEARCH = 公开检索
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

  // P2-3: report enhancement state
  const [activeTab, setActiveTab] = React.useState("report");
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  // P5-2: holds a task ID from URL params (?task=xxx) for deep-linking from
  // global search. Cleared after the task is loaded.
  const pendingTaskRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskParam = params.get("task");
    if (taskParam) pendingTaskRef.current = taskParam;
    fetch("/api/knowledge-base", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ kbs }) => setKbs(kbs));
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount effect (refreshHistory is stable)
  }, []);

  function refreshHistory() {
    fetch("/api/agent/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ tasks }) => {
        setHistory(tasks);
        // P5-2: deep-link - open the requested task once history is ready.
        if (pendingTaskRef.current) {
          const tid = pendingTaskRef.current;
          pendingTaskRef.current = null;
          if (tasks.some((t: { id: string }) => t.id === tid)) loadTask(tid);
        }
      });
  }

  async function loadTask(id: string) {
    const res = await fetch(`/api/agent/tasks/${id}`, { cache: "no-store" });
    const { task } = await res.json();
    if (task) {
      setTask(task);
      setSteps(task.steps);
      setHighlightN(null);
      setActiveTab("report");
      setEditing(false);
    }
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
          kbId: kbId === PUBLIC_SEARCH ? undefined : kbId,
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

  function copyText(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  // P2-3: export (criterion #1). PDF opens a print window; others download.
  function doExport(fmt: ExportFormat) {
    if (!task) return;
    const url = `/api/agent/tasks/${task.id}/export?format=${fmt}`;
    if (fmt === "pdf") {
      window.open(url, "_blank");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function startEdit() {
    if (!task?.report) return;
    setEditText(task.report);
    setEditing(true);
  }

  async function saveEdit() {
    if (!task) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/tasks/${task.id}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: editText }),
      });
      const { task: updated } = await res.json();
      if (updated) {
        setTask(updated);
        setEditing(false);
        refreshHistory();
      }
    } finally {
      setSaving(false);
    }
  }

  async function onVersionRestored() {
    if (task) await loadTask(task.id);
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
                <SelectItem value={PUBLIC_SEARCH}>公开检索（模拟）</SelectItem>
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
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {editing ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                        <X className="h-3.5 w-3.5" /> 取消
                      </Button>
                      <Button variant="gradient" size="sm" onClick={saveEdit} disabled={saving}>
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        保存
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => copyText(task!.report!, "report")}>
                        {copied === "report" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        复制
                      </Button>
                      <Button variant="outline" size="sm" onClick={startEdit}>
                        <Pencil className="h-3.5 w-3.5" /> 编辑
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                        <Share2 className="h-3.5 w-3.5" /> 分享设置
                      </Button>
                      <DropdownMenu
                        trigger={
                          <Button variant="gradient" size="sm">
                            <Download className="h-3.5 w-3.5" /> 导出 <ChevronDown className="h-3 w-3" />
                          </Button>
                        }
                      >
                        {EXPORT_ITEMS.map((it) => (
                          <DropdownMenuItem key={it.value} onClick={() => doExport(it.value)}>
                            <it.icon className="h-3.5 w-3.5" /> {it.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>

              {!editing && (task!.versions?.length ?? 0) > 0 && (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-2">
                  <TabsList>
                    <TabsTrigger value="report"><FileText className="h-3.5 w-3.5" /> 报告</TabsTrigger>
                    <TabsTrigger value="versions"><GitBranch className="h-3.5 w-3.5" /> 版本 ({task!.versions!.length})</TabsTrigger>
                    <TabsTrigger value="comments"><MessageSquare className="h-3.5 w-3.5" /> 评论 ({task!.comments?.length ?? 0})</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              {editing ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={24}
                  className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : activeTab === "versions" ? (
                <VersionsPanel taskId={task!.id} versions={task!.versions ?? []} current={task!.report ?? ""} onRestore={onVersionRestored} />
              ) : activeTab === "comments" ? (
                <CommentsPanel taskId={task!.id} citations={task!.citations} />
              ) : (
                <Markdown text={showReport} onCite={setHighlightN} />
              )}
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
                    onClick={() => loadTask(t.id)}
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

      {task && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} taskId={task.id} />
      )}
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
function WorkflowDag({ nodes, edges }: { nodes: DagNode[]; edges: DagEdge[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/20 p-3">
      <span className="mr-1 text-[10px] font-medium text-muted-foreground">DAG</span>
      {nodes.map((node, i) => {
        const Icon = ROLE_ICON[node.role];
        const isDone = node.status === "done";
        const isRunning = node.status === "running";
        const isSkipped = node.status === "skipped";
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
                  {edge.conditional ? "?" : "->"}
                </span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── P2-3: Version history panel (criterion #3) ───────────────────────────

function VersionsPanel({
  taskId,
  versions,
  current,
  onRestore,
}: {
  taskId: string;
  versions: ReportVersion[];
  current: string;
  onRestore: () => Promise<void>;
}) {
  const [diffVid, setDiffVid] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<DiffLine[]>([]);
  const [busy, setBusy] = React.useState(false);

  const selected = versions.find((v) => v.id === diffVid);

  function showDiff(v: ReportVersion) {
    setDiffVid(v.id);
    setDiff(diffLines(v.content, current));
  }

  async function restore(v: ReportVersion) {
    if (!confirm(`恢复到「${v.label}」？当前内容会先自动保存为一个版本。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/tasks/${taskId}/versions/${v.id}`, { method: "POST" });
      if (res.ok) {
        await onRestore();
        setDiffVid(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (versions.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">暂无修订历史</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {versions.map((v) => (
          <div
            key={v.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-2.5 transition-colors",
              diffVid === v.id ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{v.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {new Date(v.createdAt).toLocaleString("zh-CN", { hour12: false })}
                {v.author ? ` · ${v.author}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => showDiff(v)}>
              对比当前
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => restore(v)} disabled={busy}>
              <RotateCcw className="h-3 w-3" /> 恢复
            </Button>
          </div>
        ))}
      </div>

      {selected && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium">
              「{selected.label}」→ 当前 的差异
            </span>
            <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setDiffVid(null)}>
              <X className="h-3 w-3" /> 关闭
            </button>
          </div>
          <DiffView diff={diff} />
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  if (diff.every((d) => d.op === "equal")) {
    return <p className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">两个版本内容完全相同。</p>;
  }
  const added = diff.filter((d) => d.op === "add").length;
  const removed = diff.filter((d) => d.op === "remove").length;
  return (
    <div>
      <div className="mb-1.5 flex gap-3 text-[11px]">
        <span className="text-green-600">+{added} 新增</span>
        <span className="text-red-600">-{removed} 删除</span>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
        {diff.map((d, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words px-1.5 py-0.5",
              d.op === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
              d.op === "remove" && "bg-red-500/10 text-red-700 dark:text-red-400"
            )}
          >
            <span className="mr-1 select-none text-muted-foreground">
              {d.op === "add" ? "+" : d.op === "remove" ? "-" : " "}
            </span>
            {d.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── P2-3: Comments panel (collaboration) ─────────────────────────────────

function CommentsPanel({ taskId, citations }: { taskId: string; citations: AgentCitation[] }) {
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [text, setText] = React.useState("");
  const [citeN, setCiteN] = React.useState<string>("general");
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState("");

  function load() {
    fetch(`/api/agent/tasks/${taskId}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ comments }) => setComments(comments ?? []));
  }
  React.useEffect(load, [taskId]);

  async function submit() {
    if (!text.trim()) return;
    const body: { text: string; citeN?: number } = { text: text.trim() };
    if (citeN !== "general") body.citeN = Number(citeN);
    await fetch(`/api/agent/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setText("");
    load();
  }

  async function submitReply(parentId: string) {
    if (!replyText.trim()) return;
    await fetch(`/api/agent/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText.trim(), parentId }),
    });
    setReplyText("");
    setReplyTo(null);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/agent/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
    load();
  }

  // group: general (no citeN) + per-citation
  const general = comments.filter((c) => c.citeN === undefined);
  const byCite = new Map<number, Comment[]>();
  for (const c of comments) {
    if (c.citeN !== undefined) {
      const arr = byCite.get(c.citeN) ?? [];
      arr.push(c);
      byCite.set(c.citeN, arr);
    }
  }
  const childrenOf = (pid: string) => comments.filter((c) => c.parentId === pid);

  const renderComment = (c: Comment) => (
    <div key={c.id} className="rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
          {(c.userName || "?").charAt(0).toUpperCase()}
        </span>
        <span className="text-xs font-medium">{c.userName}</span>
        <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
        <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => remove(c.id)} title="删除">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1.5 text-xs text-foreground/90 whitespace-pre-wrap">{c.text}</p>
      <button
        className="mt-1 text-[11px] text-muted-foreground hover:text-primary"
        onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
      >
        回复
      </button>
      {replyTo === c.id && (
        <div className="mt-2 flex gap-1.5">
          <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="回复…" className="h-8 text-xs" />
          <Button size="sm" className="h-8" onClick={() => submitReply(c.id)}>回复</Button>
        </div>
      )}
      {childrenOf(c.id).length > 0 && (
        <div className="mt-2 space-y-1.5 border-l-2 border-border pl-2.5">
          {childrenOf(c.id).map(renderComment)}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* new comment */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Plus className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">添加评论</span>
          <Select value={citeN} onValueChange={setCiteN}>
            <SelectTrigger className="ml-auto h-7 w-[160px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">通用评论</SelectItem>
              {citations.map((c) => (
                <SelectItem key={c.n} value={String(c.n)}>引用 [{c.n}]</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="写下你的批注或讨论…"
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={submit} disabled={!text.trim()}>发表</Button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">暂无评论，添加第一条批注吧</p>
      ) : (
        <>
          {general.filter((c) => !c.parentId).map(renderComment)}
          {Array.from(byCite.entries()).map(([n, list]) => (
            <div key={n}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">{n}</span>
                引用 [{n}] 的批注
              </div>
              <div className="space-y-1.5">
                {list.filter((c) => !c.parentId).map(renderComment)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── P2-3: Share settings dialog (criterion #2) ───────────────────────────

function ShareDialog({
  open,
  onOpenChange,
  taskId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: string;
}) {
  const [cfg, setCfg] = React.useState<ShareConfig | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [days, setDays] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [maxViews, setMaxViews] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch(`/api/agent/tasks/${taskId}/share`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ shareConfig }) => {
        setCfg(shareConfig);
        setEnabled(!!shareConfig?.enabled);
        if (shareConfig?.expiresAt) {
          setDays(String(Math.max(1, Math.ceil((shareConfig.expiresAt - Date.now()) / 86400000))));
        }
        setMaxViews(shareConfig?.maxViews ? String(shareConfig.maxViews) : "");
      });
  }, [open, taskId]);

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { enabled };
    if (days) body.expiresAt = Date.now() + Number(days) * 86400000;
    else body.expiresAt = null;
    body.password = password || null;
    body.maxViews = maxViews ? Number(maxViews) : null;
    try {
      const res = await fetch(`/api/agent/tasks/${taskId}/share`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { shareConfig } = await res.json();
      setCfg(shareConfig);
      setPassword("");
      setEnabled(!!shareConfig?.enabled);
    } finally {
      setSaving(false);
    }
  }

  const shareUrl = `${window.location.origin}/r/${taskId}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2"><Share2 className="h-4 w-4 text-primary" /> 分享设置</DialogTitle>
        <DialogDescription className="text-xs">
          控制公开分享链接的访问权限：有效期、密码、访问次数。
        </DialogDescription>

        <div className="space-y-3">
          {/* share link */}
          <div className="rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">分享链接</div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 truncate rounded bg-background px-2 py-1 text-[11px]">{shareUrl}</code>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            {cfg && <div className="mt-1.5 text-[10px] text-muted-foreground">已访问 {cfg.views} 次{cfg.maxViews ? ` / 上限 ${cfg.maxViews}` : ""}</div>}
          </div>

          {/* enable protection */}
          <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
            <div>
              <div className="text-xs font-medium">启用访问保护</div>
              <div className="text-[10px] text-muted-foreground">关闭后任何人持链接可访问</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <div className="space-y-2.5 rounded-lg border border-border p-2.5">
              <div>
                <Label className="mb-1 block text-[11px]">有效期（天，留空=永久）</Label>
                <Input value={days} onChange={(e) => setDays(e.target.value)} type="number" min={1} placeholder="如 7" className="h-8 text-xs" />
              </div>
              <div>
                <Label className="mb-1 block text-[11px]">访问密码（留空=无密码）</Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="设置密码" className="h-8 text-xs" />
                {cfg?.passwordHash && !password && <span className="mt-0.5 block text-[10px] text-muted-foreground">已设置密码（输入新密码可替换）</span>}
              </div>
              <div>
                <Label className="mb-1 block text-[11px]">最大访问次数（留空=不限）</Label>
                <Input value={maxViews} onChange={(e) => setMaxViews(e.target.value)} type="number" min={1} placeholder="如 100" className="h-8 text-xs" />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
