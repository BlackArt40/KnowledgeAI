import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "./features";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "免费版",
    price: "¥0",
    period: "/月",
    desc: "适合个人体验与小型项目",
    cta: "免费开始",
    href: "/register",
    featured: false,
    features: [
      "每月 100 次智能问答",
      "1 个知识库",
      "最多 50 篇文档",
      "社区支持",
    ],
  },
  {
    name: "专业版",
    price: "¥49",
    period: "/月",
    desc: "为高效团队打造的进阶方案",
    cta: "升级专业版",
    href: "/register",
    featured: true,
    features: [
      "无限智能问答",
      "Agent 调研功能",
      "10 个知识库",
      "API 密钥与调用",
      "优先邮件支持",
    ],
  },
  {
    name: "企业版",
    price: "定制",
    period: "",
    desc: "面向组织的私有化与合规",
    cta: "联系销售",
    href: "/#",
    featured: false,
    features: [
      "支持私有部署",
      "SSO 单点登录",
      "SLA 服务保障",
      "专属客户成功经理",
      "定制模型与限流",
    ],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="定价"
          title="简单透明的价格"
          desc="从免费开始，随团队成长随时升级。所有套餐均含数据隔离与 GDPR 合规。"
        />

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-7 transition-all",
                p.featured
                  ? "border-primary/50 shadow-xl shadow-primary/10 lg:-translate-y-3 lg:scale-[1.02]"
                  : "border-border hover:border-primary/30 hover:shadow-md"
              )}
            >
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-brand-gradient px-3 py-1 text-white shadow-md">
                    <Sparkles className="h-3 w-3" /> 最受欢迎
                  </Badge>
                </div>
              )}

              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">
                  {p.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  {p.period}
                </span>
              </div>

              <Button
                variant={p.featured ? "gradient" : "outline"}
                className="mt-6 w-full"
                asChild
              >
                <Link href={p.href}>{p.cta}</Link>
              </Button>

              <ul className="mt-7 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15">
                      <Check className="h-3 w-3 text-success" />
                    </span>
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
