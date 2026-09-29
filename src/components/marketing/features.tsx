"use client";

import { Brain, Bot, FolderUp, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";

export function Features() {
  const t = useT();
  const items = [
    { icon: Brain, title: t("page.features.s4"), desc: t("page.features.s5") },
    { icon: Bot, title: t("page.features.s9"), desc: t("page.features.s10") },
    { icon: FolderUp, title: t("page.features.s12"), desc: t("page.features.s13") },
    { icon: ShieldCheck, title: t("page.features.s21"), desc: t("page.features.s22") },
  ];

  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <Badge variant="outline" className="mb-4 rounded-full bg-card/70">
            {t("page.features.s1")}
          </Badge>
          <h2 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
            {t("page.features.s2")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            {t("page.features.s3")}
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {items.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/35"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
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
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Badge variant="outline" className="mb-4 rounded-full bg-card/70">
        {eyebrow}
      </Badge>
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
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
