// Pure DAG helpers extracted from AgentView so the inference rules can be
// unit-tested without mounting the 1800-line SFC.
import { TEMPLATES, type TemplateId } from "@shared/agent/templates";
import type { AgentStep, DagEdge, DagNode } from "@shared/agent/types";

export type TFunc = (k: string) => string;

export const ROLE_ORDER = ["planner", "searcher", "analyzer", "writer"] as const;

export function roleLabel(t: TFunc, role: string): string {
  return role === "planner" ? t("page.agent.s40")
    : role === "searcher" ? t("page.agent.s41")
    : role === "analyzer" ? t("page.agent.s42")
    : t("page.agent.s43");
}

export function inferDagNodes(steps: AgentStep[], agents: string[], t: TFunc): DagNode[] {
  return ROLE_ORDER.map((r, i) => {
    const step = steps.find((s) => s.role === r);
    return {
      id: r,
      name: roleLabel(t, r),
      role: r as DagNode["role"],
      status: step ? (step.status as DagNode["status"]) : "pending",
      enabled: agents.includes(r),
      indegree: i === 0 ? 0 : 1,
    };
  });
}

export function inferDagEdges(tplId: TemplateId): DagEdge[] {
  const tpl = TEMPLATES.find((x) => x.id === tplId) ?? TEMPLATES[0];
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
