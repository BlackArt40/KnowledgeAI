// 订阅计费 API（V4，契约与 /api/billing* /api/usage 冻结一致）。套餐目录、
// 对比表与状态/支付方式标签单源复用 src/lib/billing/{types,plans}（纯 TS）。
import { request } from "./client";
import type { Invoice, PayMethod, Plan, PlanId, Subscription, Usage } from "@shared/billing/types";

export type { Invoice, PayMethod, Plan, PlanId, Subscription, Usage } from "@shared/billing/types";

export interface BillingData {
  subscription: Subscription;
  usage: Usage;
  invoices: Invoice[];
  plans: Plan[];
}

export interface WorkspaceUsage {
  usage: {
    workspaceId: string;
    qaUsed: number;
    qaLimit: number | null;
    storageUsed: number;
    storageLimit: number | null;
    agentTasks: number;
    agentLimit: number | null;
    kbCount: number;
  };
  plan: string;
  /** 每用户计量（含 QA/API 趋势序列） */
  userUsage?: Usage;
}

export async function fetchBilling(): Promise<BillingData> {
  return request<BillingData>("/api/billing");
}

/** 创建待支付订单 { plan, method } → { order }。 */
export async function checkoutOrder(
  plan: PlanId,
  method: PayMethod
): Promise<{ order: { id: string }; checkout?: unknown }> {
  return request("/api/billing/checkout", { method: "POST", body: { plan, method } });
}

/** 模拟支付（确认网关回调）→ 升级订阅 + 生成账单。 */
export async function payOrder(id: string): Promise<{ success?: boolean }> {
  return request(`/api/billing/checkout/${encodeURIComponent(id)}`, { method: "POST" });
}

/** 取消 / 恢复订阅 { action: "cancel" | "resume" }。 */
export function cancelResume(action: "cancel" | "resume"): Promise<unknown> {
  return request("/api/billing/cancel", { method: "POST", body: { action } });
}

export async function fetchUsage(): Promise<WorkspaceUsage> {
  return request<WorkspaceUsage>("/api/usage");
}
