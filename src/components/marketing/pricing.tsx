"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./features";
import { cn } from "@/lib/utils";
import { getPlan } from "@/lib/billing/plans";

function plans(t: (key: string) => string) {
  return [
    {
      name: t("page.pricing.s0"),
      price: `¥${getPlan("free").price}`,
      period: t("page.pricing.s1"),
      desc: t("page.pricing.s2"),
      cta: t("page.pricing.s3"),
      featured: false,
      features: [t("page.pricing.s4"), t("page.pricing.s5"), t("page.pricing.s6")],
    },
    {
      name: t("page.pricing.s8"),
      price: `¥${getPlan("pro").price}`,
      period: t("page.pricing.s1"),
      desc: t("page.pricing.s9"),
      cta: t("page.pricing.s10"),
      featured: true,
      features: [t("page.pricing.s11"), t("page.pricing.s12"), t("page.pricing.s13")],
    },
    {
      name: t("page.pricing.s16"),
      price: t("page.pricing.s17"),
      period: "",
      desc: t("page.pricing.s18"),
      cta: t("page.pricing.s19"),
      featured: false,
      features: [t("page.pricing.s20"), t("page.pricing.s21"), t("page.pricing.s22")],
    },
  ];
}

export function Pricing() {
  const t = useT();

  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.pricing.s25")}
          title={t("page.pricing.s26")}
          desc={t("page.pricing.s27")}
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {plans(t).map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6",
                plan.featured ? "border-primary/45 shadow-lg shadow-primary/5" : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{plan.name}</h3>
                {plan.featured && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    {t("page.pricing.s28")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{plan.desc}</p>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>

              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.featured ? "default" : "outline"}
                className="mt-7 w-full"
                asChild
              >
                <Link href="/register">{plan.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
