import type { Plan, PlanId } from "./types";

export const PLANS: Plan[] = [
  {
    id: "free", name: "免费版", price: 0, period: "月",
    qaLimit: 100, kbLimit: 1, docLimit: 50, agent: false, api: false, seats: 1,
    support: "社区支持",
    features: ["每月 100 次问答", "1 个知识库", "最多 50 篇文档", "社区支持"],
  },
  {
    id: "pro", name: "专业版", price: 49, period: "月", highlight: true,
    qaLimit: null, kbLimit: 10, docLimit: null, agent: true, api: true, seats: 10,
    support: "优先邮件支持",
    features: ["无限智能问答", "Agent 调研", "10 个知识库", "API 密钥", "优先支持"],
  },
  {
    id: "enterprise", name: "企业版", price: null, period: "定制",
    qaLimit: null, kbLimit: null, docLimit: null, agent: true, api: true, seats: null,
    support: "专属客户成功经理",
    features: ["支持私有部署", "SSO 单点登录", "SLA 服务保障", "专属支持", "定制模型与限流"],
  },
];

export function getPlan(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

// comparison table rows: label → value per plan
export const COMPARISON: { label: string; values: (string | boolean)[] }[] = [
  { label: "智能问答", values: ["100 次/月", "无限", "无限"] },
  { label: "知识库", values: ["1 个", "10 个", "不限"] },
  { label: "文档数", values: ["50 篇", "不限", "不限"] },
  { label: "Agent 调研", values: [false, true, true] },
  { label: "API 密钥", values: [false, true, true] },
  { label: "团队成员", values: ["1 人", "10 人", "不限"] },
  { label: "私有部署", values: [false, false, true] },
  { label: "SSO 单点登录", values: [false, false, true] },
  { label: "SLA 保障", values: [false, false, true] },
  { label: "技术支持", values: ["社区", "优先邮件", "专属经理"] },
];
