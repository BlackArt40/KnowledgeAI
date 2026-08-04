// Workflow templates: predefined research configurations that map to
// StateGraph structures. Each template defines:
// - which agent nodes are included (planner/searcher/analyzer/writer)
// - the section structure for the research outline
// - the conditional branches (e.g., expand search if retrieval is insufficient)
// - the parallel execution plan (e.g., multi-section search concurrently)
//
// Templates: competitive (竞品分析), tech-selection (技术选型), market (市场洞察).

import type { AgentRole } from "./types";

export type TemplateId = "competitive" | "tech-selection" | "market" | "default";

export interface WorkflowTemplate {
  id: TemplateId;
  name: string;
  description: string;
  icon: string; // lucide icon name
  /** Agent roles enabled in this template. */
  agents: AgentRole[];
  /** Research section structure (used by planner + writer). */
  sections: { id: string; title: string }[];
  /** Whether to use parallel multi-section search (criterion #2: parallel). */
  parallelSearch: boolean;
  /** Whether to use conditional branch: expand search if results insufficient. */
  conditionalExpand: boolean;
  /** Default output format. */
  defaultFormat: "report" | "ppt" | "mindmap";
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "default",
    name: "通用调研",
    description: "标准四阶段：规划 → 检索 → 分析 → 撰写",
    icon: "Sparkles",
    agents: ["planner", "searcher", "analyzer", "writer"],
    sections: [
      { id: "background", title: "背景概述" },
      { id: "status", title: "现状分析" },
      { id: "trends", title: "核心趋势" },
      { id: "challenges", title: "关键挑战" },
      { id: "outlook", title: "建议与展望" },
    ],
    parallelSearch: false,
    conditionalExpand: false,
    defaultFormat: "report",
  },
  {
    id: "competitive",
    name: "竞品分析",
    description: "对比分析多个竞品的功能、定位、优劣",
    icon: "Swords",
    agents: ["planner", "searcher", "analyzer", "writer"],
    sections: [
      { id: "overview", title: "竞品概览" },
      { id: "features", title: "功能对比" },
      { id: "positioning", title: "定位差异" },
      { id: "strengths", title: "优势分析" },
      { id: "weaknesses", title: "劣势与风险" },
      { id: "recommendation", title: "选型建议" },
    ],
    parallelSearch: true, // search each competitor in parallel
    conditionalExpand: true, // expand if a competitor has insufficient data
    defaultFormat: "report",
  },
  {
    id: "tech-selection",
    name: "技术选型",
    description: "评估技术方案的可行性、性能、生态",
    icon: "Code2",
    agents: ["planner", "searcher", "analyzer", "writer"],
    sections: [
      { id: "context", title: "技术背景" },
      { id: "options", title: "候选方案" },
      { id: "comparison", title: "对比分析" },
      { id: "pros-cons", title: "优劣势" },
      { id: "feasibility", title: "可行性评估" },
      { id: "decision", title: "推荐方案" },
    ],
    parallelSearch: true, // search each tech option in parallel
    conditionalExpand: true,
    defaultFormat: "report",
  },
  {
    id: "market",
    name: "市场洞察",
    description: "分析市场规模、趋势、机会与风险",
    icon: "TrendingUp",
    agents: ["planner", "searcher", "analyzer", "writer"],
    sections: [
      { id: "size", title: "市场规模" },
      { id: "growth", title: "增长趋势" },
      { id: "segments", title: "细分赛道" },
      { id: "drivers", title: "驱动因素" },
      { id: "risks", title: "风险与挑战" },
      { id: "opportunity", title: "机会窗口" },
    ],
    parallelSearch: true,
    conditionalExpand: false,
    defaultFormat: "report",
  },
];

export function getTemplate(id: TemplateId): WorkflowTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
