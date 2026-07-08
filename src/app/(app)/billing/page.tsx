"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check, X, Crown, CreditCard, Download, Loader2, RotateCcw, Sparkles, Receipt,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { COMPARISON, PLANS } from "@/lib/billing/plans";
import { METHOD_LABEL, STATUS_LABEL, type Plan, type Subscription, type Invoice, type Usage } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

interface BillingData {
  subscription: Subscription;
  usage: Usage;
  invoices: Invoice[];
  plans: Plan[];
}

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = React.useState<BillingData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [canceling, setCanceling] = React.useState(false);

  const fetchBilling = React.useCallback(async () => {
    try {
      const res = await fetch("/api/billing", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { fetchBilling(); }, [fetchBilling]);

  async function toggleCancel(action: "cancel" | "resume") {
    setCanceling(true);
    try {
      await fetch("/api/billing/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      fetchBilling();
    } finally { setCanceling(false); }
  }

  function downloadInvoices() {
    if (!data) return;
    const rows = [["账单号", "日期", "金额(¥)", "套餐", "状态", "支付方式"]];
    data.invoices.forEach((i) => rows.push([i.id, new Date(i.date).toLocaleDateString("zh-CN"), String(i.amount), i.plan, i.status, METHOD_LABEL[i.method]]));
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "invoices.csv";
    a.click();
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const { subscription, invoices, plans } = data;
  const currentPlan = plans.find((p) => p.id === subscription.plan)!;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* current plan */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-transparent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient text-white">
                <Crown className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">{currentPlan.name}</h2>
                  <Badge variant={subscription.status === "active" ? "success" : "warning"}>
                    {STATUS_LABEL[subscription.status]}
                  </Badge>
                  {subscription.cancelAtPeriodEnd && <Badge variant="warning">周期末失效</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {currentPlan.price === null ? "定制报价" : `¥${currentPlan.price}/${currentPlan.period}`} ·
                  {subscription.seats} 席位 ·
                  支付方式 {subscription.paymentMethod ? METHOD_LABEL[subscription.paymentMethod.type] : "—"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  当前周期：{new Date(subscription.periodStart).toLocaleDateString("zh-CN")} ~ {new Date(subscription.periodEnd).toLocaleDateString("zh-CN")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {subscription.status === "canceled" ? (
                <Button variant="gradient" onClick={() => toggleCancel("resume")} disabled={canceling}>
                  {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} 恢复订阅
                </Button>
              ) : subscription.plan !== "enterprise" ? (
                <Button variant="gradient" onClick={() => router.push(`/checkout?plan=enterprise`)}>
                  <Sparkles className="h-4 w-4" /> 升级企业版
                </Button>
              ) : null}
              {subscription.status !== "canceled" && subscription.plan !== "free" && (
                <Button variant="outline" onClick={() => toggleCancel("cancel")} disabled={canceling}>
                  取消订阅
                </Button>
              )}
            </div>
          </CardContent>
        </div>
      </Card>

      {/* comparison */}
      <div>
        <h3 className="mb-3 text-base font-semibold">套餐对比</h3>
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">功能</th>
                  {plans.map((p) => (
                    <th key={p.id} className="px-4 py-3 text-center">
                      <div className={cn("font-semibold", p.id === subscription.plan && "text-primary")}>
                        {p.name}
                        {p.id === subscription.plan && <Badge variant="default" className="ml-1.5 text-[10px]">当前</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {p.price === null ? "定制" : p.price === 0 ? "免费" : `¥${p.price}/${p.period}`}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    {row.values.map((v, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        {typeof v === "boolean" ? (
                          v ? <Check className="mx-auto h-4 w-4 text-success" /> : <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                        ) : (
                          <span className="text-muted-foreground">{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-3" />
                  {plans.map((p) => (
                    <td key={p.id} className="px-4 py-3 text-center">
                      {p.id === subscription.plan ? (
                        <span className="text-xs text-muted-foreground">当前套餐</span>
                      ) : p.price === null ? (
                        <Button variant="outline" size="sm" onClick={() => router.push(`/checkout?plan=${p.id}`)}>联系销售</Button>
                      ) : (
                        <Button variant={p.highlight ? "gradient" : "outline"} size="sm" onClick={() => router.push(`/checkout?plan=${p.id}`)}>
                          {p.price === 0 ? "降级免费版" : "切换套餐"}
                        </Button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* invoices */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-primary" /> 账单历史
          </CardTitle>
          <Button variant="outline" size="sm" onClick={downloadInvoices}>
            <Download className="h-3.5 w-3.5" /> 导出 CSV
          </Button>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CreditCard className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{inv.id}</p>
                <p className="text-xs text-muted-foreground">{new Date(inv.date).toLocaleDateString("zh-CN")} · {METHOD_LABEL[inv.method]}</p>
              </div>
              <Badge variant={inv.status === "paid" ? "success" : inv.status === "pending" ? "warning" : "destructive"}>
                {inv.status === "paid" ? "已支付" : inv.status === "pending" ? "待支付" : "已退款"}
              </Badge>
              <span className="w-20 text-right text-sm font-semibold tabular-nums">¥{inv.amount}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
