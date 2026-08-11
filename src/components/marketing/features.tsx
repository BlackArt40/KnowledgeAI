"use client";

import { useT } from "@/lib/i18n/provider";

import {
  Brain,
  FolderUp,
  Bot,
  Users,
  ShieldCheck,
  BarChart3,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Features() {
  const t = useT();
  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.features.s1")}
          title={t("page.features.s2")}
          desc={t("page.features.s3")}
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          {/* RAG Q&A — large */}
          <FeatureCard
            className="md:col-span-4"
            icon={Brain}
            title={t("page.features.s4")}
            desc={t("page.features.s5")}
            tags={[t("page.features.s6"), t("page.features.s7"), t("page.features.s8")]}
          >
            <MiniChat />
          </FeatureCard>

          {/* Agent research — tall */}
          <FeatureCard
            className="md:col-span-2 md:row-span-2"
            icon={Bot}
            title={t("page.features.s9")}
            desc={t("page.features.s10")}
            tags={["LangGraph", t("page.features.s11")]}
          >
            <MiniTimeline />
          </FeatureCard>

          {/* KB upload */}
          <FeatureCard
            className="md:col-span-2"
            icon={FolderUp}
            title={t("page.features.s12")}
            desc={t("page.features.s13")}
            tags={[t("page.features.s14")]}
          />

          {/* Team */}
          <FeatureCard
            className="md:col-span-2"
            icon={Users}
            title={t("page.features.s15")}
            desc={t("page.features.s16")}
            tags={["RBAC", t("page.features.s17")]}
          />

          {/* row 3 */}
          <FeatureCard
            className="md:col-span-2"
            icon={BarChart3}
            title={t("page.features.s18")}
            desc={t("page.features.s19")}
            tags={[t("page.features.s20")]}
          />
          <FeatureCard
            className="md:col-span-2"
            icon={ShieldCheck}
            title={t("page.features.s21")}
            desc={t("page.features.s22")}
            tags={["GDPR"]}
          />
          <FeatureCard
            className="md:col-span-2"
            icon={ArrowUpRight}
            title={t("page.features.s23")}
            desc={t("page.features.s24")}
            tags={["Stripe"]}
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  tags,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  tags?: string[];
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${className ?? ""}`}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {desc}
      </p>
      {tags && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
      {children && <div className="mt-5 flex-1">{children}</div>}
    </div>
  );
}

function MiniChat() {
  const t = useT();
  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex justify-end">
        <span className="rounded-xl rounded-br-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          本季度核心指标？
        </span>
      </div>
      <div className="flex gap-2">
        <span className="mt-0.5 h-6 w-6 rounded-md bg-brand-gradient" />
        <span className="rounded-xl rounded-tl-sm bg-background px-3 py-1.5 text-xs">
          营收同比增长 38%，RAG 调用量翻倍
          <sup className="ml-1 text-primary">[1]</sup>
        </span>
      </div>
    </div>
  );
}

function MiniTimeline() {
  const t = useT();
  const steps = [
    { label: "Plan", done: true },
    { label: "Search", done: true },
    { label: "Analyze", done: false },
    { label: "Write", done: false },
  ];
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${
              s.done
                ? "bg-brand-gradient text-white"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            {i + 1}
          </span>
          <span className="text-sm font-medium">{s.label}</span>
          {s.done && (
            <span className="ml-auto text-[11px] text-success">{t("page.features.s0")}</span>
          )}
          {!s.done && i === 2 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary" />
              进行中
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
}) {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Badge variant="default" className="mb-4">
        {eyebrow}
      </Badge>
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {desc && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
          {desc}
        </p>
      )}
    </div>
  );
}
