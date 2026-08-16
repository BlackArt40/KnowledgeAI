"use client";

import { useT } from "@/lib/i18n/provider";

import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "./features";
import { cn } from "@/lib/utils";

function plans(t: (k: string) => string) {
  return [
  {
    name: t("page.pricing.s0"),
    price: "¥0",
    period: t("page.pricing.s1"),
    desc: t("page.pricing.s2"),
    cta: t("page.pricing.s3"),
    href: "/register",
    featured: false,
    features: [
      t("page.pricing.s4"),
      t("page.pricing.s5"),
      t("page.pricing.s6"),
      t("page.pricing.s7"),
    ],
  },
  {
    name: t("page.pricing.s8"),
    price: "¥49",
    period: t("page.pricing.s1"),
    desc: t("page.pricing.s9"),
    cta: t("page.pricing.s10"),
    href: "/register",
    featured: true,
    features: [
      t("page.pricing.s11"),
      t("page.pricing.s12"),
      t("page.pricing.s13"),
      t("page.pricing.s14"),
      t("page.pricing.s15"),
    ],
  },
  {
    name: t("page.pricing.s16"),
    price: t("page.pricing.s17"),
    period: "",
    desc: t("page.pricing.s18"),
    cta: t("page.pricing.s19"),
    href: "/#",
    featured: false,
    features: [
      t("page.pricing.s20"),
      t("page.pricing.s21"),
      t("page.pricing.s22"),
      t("page.pricing.s23"),
      t("page.pricing.s24"),
    ],
  },
];
};

export function Pricing() {
  const t = useT();
  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.pricing.s25")}
          title={t("page.pricing.s26")}
          desc={t("page.pricing.s27")}
        />

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {plans(t).map((p) => (
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
                    <Sparkles className="h-3 w-3" /> {t("page.pricing.s28")}
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
