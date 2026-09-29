"use client";

import { Upload, Database, MessageSquareText, FileBarChart } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { SectionHeading } from "./features";

export function Workflow() {
  const t = useT();
  const steps = [
    { icon: Upload, title: t("page.workflow.s0") },
    { icon: Database, title: t("page.workflow.s2") },
    { icon: MessageSquareText, title: t("page.workflow.s4") },
    { icon: FileBarChart, title: t("page.workflow.s6") },
  ];

  return (
    <section id="workflow" className="scroll-mt-20 border-y border-border bg-muted/25 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.workflow.s8")}
          title={t("page.workflow.s9")}
          desc={t("page.workflow.s10")}
        />

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title }, index) => (
            <div
              key={title}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">0{index + 1}</span>
                <span className="text-sm font-semibold">{title}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
