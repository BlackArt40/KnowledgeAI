"use client";

import { useT } from "@/lib/i18n/provider";

import { Upload, Database, MessageSquareText, FileBarChart } from "lucide-react";
import { SectionHeading } from "./features";

function steps(t: (k: string) => string) {
  return [
  {
    icon: Upload,
    title: t("page.workflow.s0"),
    desc: t("page.workflow.s1"),
  },
  {
    icon: Database,
    title: t("page.workflow.s2"),
    desc: t("page.workflow.s3"),
  },
  {
    icon: MessageSquareText,
    title: t("page.workflow.s4"),
    desc: t("page.workflow.s5"),
  },
  {
    icon: FileBarChart,
    title: t("page.workflow.s6"),
    desc: t("page.workflow.s7"),
  },
];
};

export function Workflow() {
  const t = useT();
  return (
    <section id="workflow" className="scroll-mt-20 border-y border-border bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.workflow.s8")}
          title={t("page.workflow.s9")}
          desc={t("page.workflow.s10")}
        />

        <div className="relative mt-14">
          {/* connecting line */}
          <div className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4 md:gap-6">
            {steps(t).map((s, i) => (
              <div key={s.title} className="relative flex flex-col items-center text-center md:items-start md:text-left">
                <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
                  <s.icon className="h-6 w-6 text-primary" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
