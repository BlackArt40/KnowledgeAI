export type AgentRole = "planner" | "searcher" | "analyzer" | "writer";
export type StepStatus = "pending" | "running" | "done" | "skipped";
export type TaskStatus = "queued" | "running" | "done" | "failed";
export type OutputFormat = "report" | "ppt" | "mindmap";

/** DAG node status for workflow visualization. */
export type NodeRunStatus = "pending" | "running" | "done" | "skipped";

/** A node in the DAG visualization (for criterion #1: workflow visualization). */
export interface DagNode {
  id: string;
  name: string;
  role: AgentRole;
  status: NodeRunStatus;
  /** Whether this node is enabled (user can toggle). */
  enabled: boolean;
  /** Incoming edge count (for layout). */
  indegree: number;
}

/** A directed edge in the DAG. */
export interface DagEdge {
  from: string;
  to: string;
  conditional: boolean;
}

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
  /** P4-3: the workspace (tenant) this task belongs to. */
  workspaceId: string;
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
  /** P2-1: workflow template id. */
  template?: string;
  /** P2-1: DAG nodes for workflow visualization. */
  dagNodes?: DagNode[];
  /** P2-1: DAG edges. */
  dagEdges?: DagEdge[];
  /** P2-1: whether parallel search was used. */
  parallelExecuted?: boolean;
  /** P2-1: whether conditional branch was triggered. */
  branchTriggered?: boolean;
  /** P2-3: share link config (expiry / password / view limit). */
  shareConfig?: ShareConfig;
  /** P2-3: report revision history (newest last). */
  versions?: ReportVersion[];
  /** P2-3: collaboration comments (inline annotations). */
  comments?: Comment[];
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

// ── P2-3: Report Enhancement types ────────────────────────────────────────

/** Export formats supported by the report exporter. */
export type ExportFormat = "md" | "pdf" | "pptx" | "mindmap";

export const EXPORT_OPTIONS: { value: ExportFormat; label: string; icon: string }[] = [
  { value: "md", label: "Markdown", icon: "FileText" },
  { value: "pdf", label: "PDF", icon: "FileDown" },
  { value: "pptx", label: "PPTX", icon: "Presentation" },
  { value: "mindmap", label: "思维导图", icon: "Network" },
];

/** Share link permission config (criterion #2: expiry + password + view limit). */
export interface ShareConfig {
  /** Whether sharing is enabled (link accessible). */
  enabled: boolean;
  /** Unix ms timestamp after which the link is expired (undefined = never). */
  expiresAt?: number;
  /** SHA-256 hash of the access password (undefined = no password). */
  passwordHash?: string;
  /** Max allowed views (undefined = unlimited). */
  maxViews?: number;
  /** Current view count. */
  views: number;
}

/** A saved report revision (criterion #3: revision history + diff). */
export interface ReportVersion {
  id: string;
  /** Human-readable label, e.g. "v1 · 初始" or "编辑于 ...". */
  label: string;
  /** Full report markdown at this revision. */
  content: string;
  /** Unix ms timestamp. */
  createdAt: number;
  /** Author display name. */
  author?: string;
}

/** A collaboration comment (criterion: inline annotation + discussion). */
export interface Comment {
  id: string;
  userId?: string;
  userName: string;
  text: string;
  /** Anchor: citation number [n] the comment attaches to (undefined = general). */
  citeN?: number;
  /** Parent comment id for threaded replies. */
  parentId?: string;
  createdAt: number;
}

