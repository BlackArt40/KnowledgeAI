// 套餐枚举（后端 free / pro / enterprise）→ i18n key 的单源映射。
// 后端把套餐存在 workspace 上（支付成功 → setWorkspacePlan），用户级 user.plan 只写给付款人，
// 所以所有「套餐」展示都应读当前工作区套餐（见 lib/workspace-store.ts），只在这里做文案映射。
export const PLAN_LABEL_KEYS: Record<string, string> = {
  free: "page.usage.planFree",
  pro: "page.usage.planPro",
  enterprise: "page.usage.planEnt",
};

/** 未知枚举返回 null，调用方自行回退（显示原始值或占位符）。 */
export function planLabelKey(plan: string | null | undefined): string | null {
  if (!plan) return null;
  return PLAN_LABEL_KEYS[plan] ?? null;
}
