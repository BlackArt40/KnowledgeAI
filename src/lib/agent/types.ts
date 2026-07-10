export type AgentRole = "planner" | "searcher" | "analyzer" | "writer";
export type StepStatus = "pending" | "running" | "done";
export type TaskStatus = "queued" | "running" | "done" | "failed";
export type OutputFormat = "report" | "ppt" | "mindmap";

export interface AgentStep {
  role: AgentRole;
  name: string;
  status: StepStatus;
  progress: number; // 0-100
  detail: string;
  result?: string; // intermediate preview (markdown)
  startedAt?: number;
  endedAt?: number;
}

export interface AgentCitation {
  n: number;
  title: string;
  source: string;
  snippet: string;
  score: number;
}

export interface AgentTask {
  id: string;
  topic: string;
  kbId?: string;
  kbName?: string;
  outputFormat: OutputFormat;
  agents: AgentRole[];
  maxSteps: number;
  status: TaskStatus;
  steps: AgentStep[];
  report?: string;
  citations: AgentCitation[];
  outline: string[];
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
  userId?: string;
}

export const AGENT_DEFS: { role: AgentRole; name: string; icon: string }[] = [
  { role: "planner", name: "规划 Agent", icon: "ListChecks" },
  { role: "searcher", name: "检索 Agent", icon: "Search" },
  { role: "analyzer", name: "分析 Agent", icon: "Brain" },
  { role: "writer", name: "写作 Agent", icon: "PenLine" },
];

export const FORMAT_OPTIONS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: "report", label: "调研报告", hint: "结构化 Markdown 报告" },
  { value: "ppt", label: "PPT 大纲", hint: "分页幻灯片大纲" },
  { value: "mindmap", label: "思维导图", hint: "嵌套列表导图" },
];
