export type PlanId = "free" | "pro" | "enterprise";
export type SubStatus = "active" | "trialing" | "canceled" | "past_due";
export type PayMethod = "wechat" | "alipay" | "card";
export type InvoiceStatus = "paid" | "pending" | "refunded";

export interface Plan {
  id: PlanId;
  name: string;
  price: number | null; // null = 定制
  period: string;
  highlight?: boolean;
  qaLimit: number | null; // null = 无限
  kbLimit: number | null;
  docLimit: number | null;
  agent: boolean;
  api: boolean;
  seats: number | null;
  support: string;
  features: string[];
}

export interface PaymentMethod {
  type: PayMethod;
  label: string;
}

export interface Subscription {
  plan: PlanId;
  status: SubStatus;
  periodStart: number;
  periodEnd: number;
  seats: number;
  paymentMethod?: PaymentMethod;
  cancelAtPeriodEnd: boolean;
}

export interface Invoice {
  id: string;
  date: number;
  amount: number;
  plan: PlanId;
  status: InvoiceStatus;
  method: PayMethod;
}

export interface UsagePoint {
  date: string;
  qa: number;
  api: number;
  agent: number;
}

export interface Usage {
  qaUsed: number;
  qaLimit: number | null;
  apiCalls: number;
  storageUsed: number; // bytes
  storageLimit: number | null;
  agentTasks: number;
  agentLimit: number | null;
  trend: UsagePoint[];
}

export interface Order {
  id: string;
  plan: PlanId;
  amount: number;
  method: PayMethod;
  status: "pending" | "paid" | "failed";
  createdAt: number;
}

export const METHOD_LABEL: Record<PayMethod, string> = {
  wechat: "微信支付",
  alipay: "支付宝",
  card: "信用卡",
};

export const STATUS_LABEL: Record<SubStatus, string> = {
  active: "生效中",
  trialing: "试用中",
  canceled: "已取消",
  past_due: "待支付",
};
