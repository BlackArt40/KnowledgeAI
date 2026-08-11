"use client";

import { useT } from "@/lib/i18n/provider";

import { Star } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SectionHeading } from "./features";

function reviews(t: (k: string) => string) {
  return [
  {
    quote:
      t("page.testimonials.s0"),
    name: t("page.testimonials.s1"),
    role: t("page.testimonials.s2"),
    initials: t("page.testimonials.s3"),
  },
  {
    quote:
      t("page.testimonials.s4"),
    name: t("page.testimonials.s5"),
    role: t("page.testimonials.s6"),
    initials: t("page.testimonials.s7"),
  },
  {
    quote:
      t("page.testimonials.s8"),
    name: t("page.testimonials.s9"),
    role: "CTO · Initech",
    initials: t("page.testimonials.s10"),
  },
];
};

export function Testimonials() {
  const t = useT();
  return (
    <section className="border-y border-border bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("page.testimonials.s11")}
          title={t("page.testimonials.s12")}
          desc={t("page.testimonials.s13")}
        />

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {reviews(t).map((r) => (
            <figure
              key={r.name}
              className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex gap-0.5 text-warning">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground">
                “{r.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <Avatar fallback={r.initials} />
                <div>
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
