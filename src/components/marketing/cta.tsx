"use client";

import { useT } from "@/lib/i18n/provider";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  const t = useT();
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center shadow-sm sm:px-16">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-grid dark:bg-grid-dark [mask-image:radial-gradient(ellipse_50%_60%_at_50%_50%,black,transparent)]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[42rem] -translate-x-1/2 -translate-y-1/2 aurora opacity-40" />

          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t("page.cta.s2")}
            <span className="text-gradient">{t("page.cta.s0")}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted-foreground">
            {t("page.cta.s3")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="gradient" size="lg" asChild>
              <Link href="/register">
                {t("page.cta.s4")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/login">{t("page.cta.s1")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
