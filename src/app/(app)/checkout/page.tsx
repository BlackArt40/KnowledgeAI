"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, QrCode, Wallet, CreditCard, Check, Loader2, ShieldCheck, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPlan, PLANS } from "@/lib/billing/plans";
import type { PayMethod, PlanId } from "@/lib/billing/types";

const METHODS: { id: PayMethod; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "wechat", label: "微信支付", icon: QrCode, hint: "扫码支付" },
  { id: "alipay", label: "支付宝", icon: Wallet, hint: "快捷支付" },
  { id: "card", label: "信用卡", icon: CreditCard, hint: "Visa / Mastercard" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CheckoutPage() {
  const router = useRouter();
  const [planId, setPlanId] = React.useState<PlanId>("pro");
  const [method, setMethod] = React.useState<PayMethod>("wechat");
  const [phase, setPhase] = React.useState<"form" | "processing" | "success">("form");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("plan") as PlanId | null;
    if (q && PLANS.some((p) => p.id === q)) setPlanId(q);
  }, []);

  const plan = getPlan(planId);
  const noPayment = plan.price === 0 || plan.price === null;

  async function confirm() {
    setError(null);
    setPhase("processing");
    try {
      const r1 = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, method }),
      });
      const { order } = await r1.json();
      await sleep(2600); // simulate QR scan / gateway confirmation
      const r2 = await fetch(`/api/billing/checkout/${order.id}`, { method: "POST" });
      const res = await r2.json();
      if (!res.success) throw new Error();
      setPhase("success");
    } catch {
      setError("支付失败，请重试");
      setPhase("form");
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回计费
      </Link>

      <div className="rounded-2xl border border-border bg-card p-6">
        {/* order summary */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">订单摘要</h2>
          <Badge variant="default">{plan.name}</Badge>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/40 p-4">
          <div>
            <p className="text-sm font-medium">{plan.name}</p>
            <p className="text-xs text-muted-foreground">{plan.features[0]}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">
              {plan.price === null ? "定制" : plan.price === 0 ? "免费" : `¥${plan.price}`}
            </p>
            <p className="text-xs text-muted-foreground">/{plan.period}</p>
          </div>
        </div>

        {phase === "success" ? (
          <SuccessView planName={plan.name} onDone={() => router.push("/billing")} />
        ) : noPayment ? (
          <NoPaymentView plan={plan} />
        ) : phase === "processing" ? (
          <ProcessingView method={method} amount={plan.price ?? 0} />
        ) : (
          <>
            {/* payment method */}
            <p className="mt-6 mb-2 text-sm font-medium">选择支付方式</p>
            <div className="space-y-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 transition-colors",
                    method === m.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-accent/40"
                  )}
                >
                  <span className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg",
                    m.id === "wechat" ? "bg-emerald-500/15 text-emerald-500" : m.id === "alipay" ? "bg-sky-500/15 text-sky-500" : "bg-violet-500/15 text-violet-500"
                  )}>
                    <m.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex-1 text-left">
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </span>
                  <span className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border-2",
                    method === m.id ? "border-primary bg-primary" : "border-border"
                  )}>
                    {method === m.id && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

            <Button variant="gradient" size="lg" className="mt-6 w-full" onClick={confirm}>
              <ShieldCheck className="h-4 w-4" />
              确认支付 ¥{plan.price}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              支付即表示同意 <Link href="/terms" className="text-primary hover:underline">服务条款</Link> · 安全加密
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ProcessingView({ method, amount }: { method: PayMethod; amount: number }) {
  const label = method === "wechat" ? "微信" : method === "alipay" ? "支付宝" : "信用卡";
  return (
    <div className="mt-6 flex flex-col items-center py-6 text-center">
      <div className="relative">
        <div className="flex h-40 w-40 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/30">
          <QrCode className="h-20 w-20 text-muted-foreground/60" />
        </div>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">演示二维码</span>
      </div>
      <p className="mt-5 flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        等待{label}支付确认…
      </p>
      <p className="mt-1 text-xs text-muted-foreground">应付 ¥{amount} · 请在手机端完成支付</p>
    </div>
  );
}

function SuccessView({ planName, onDone }: { planName: string; onDone: () => void }) {
  return (
    <div className="mt-6 flex flex-col items-center py-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="h-8 w-8" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">支付成功</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        已升级至 <span className="font-medium text-foreground">{planName}</span>，订阅立即生效。
      </p>
      <Button variant="gradient" className="mt-5" onClick={onDone}>
        <Sparkles className="h-4 w-4" /> 查看账单
      </Button>
    </div>
  );
}

function NoPaymentView({ plan }: { plan: ReturnType<typeof getPlan> }) {
  return (
    <div className="mt-6 flex flex-col items-center py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-7 w-7" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">
        {plan.price === 0 ? "免费版无需支付" : "企业版定制报价"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {plan.price === 0
          ? "切换至免费版将在当前周期末生效。"
          : "请联系销售团队获取定制方案与报价。"}
      </p>
      <Button variant="gradient" className="mt-5" asChild>
        <Link href="/billing">返回计费</Link>
      </Button>
    </div>
  );
}
