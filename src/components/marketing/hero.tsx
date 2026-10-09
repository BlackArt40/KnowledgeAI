"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { KnowledgeConsole } from "./knowledge-console";
import { LiveStatus } from "./live-status";

export function Hero() {
  const t = useT();

  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="pointer-events-none absolute inset-0 -z-20 bg-grid dark:bg-grid-dark [mask-image:radial-gradient(ellipse_68%_60%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-30rem] -z-20 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-[conic-gradient(from_120deg,transparent,hsl(var(--primary)/0.18),transparent_38%,hsl(var(--brand-to)/0.12),transparent_74%)] blur-3xl animate-orbit motion-reduce:animate-none" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[440px] bg-gradient-to-b from-background/10 via-background/45 to-background" />

      <div className="mx-auto max-w-7xl px-4 pb-14 pt-20 sm:px-6 sm:pb-20 sm:pt-28">
        <div className="mx-auto max-w-4xl text-center">
          <Link
            href="/#workflow"
            className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-xl transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/55 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {t("page.hero.s11")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>

          <h1 className="mt-8 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-7xl lg:text-[5.8rem]">
            {t("page.hero.s12")}
            <br />
            <span>{t("page.hero.s0")}</span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("page.hero.s13")}
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="default" size="lg" className="rounded-full px-7" asChild>
              <Link href="/register">
                {t("page.hero.s14")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="rounded-full bg-card/70 px-7 backdrop-blur" asChild>
              {/* 跳转页内交互式预览（下方 KnowledgeConsole，标题"实时交互预览"）；
                  此前指向 #features，会滚过演示区落到功能卡片，像"没有演示"。 */}
              <Link href="/#demo">{t("page.hero.s1")}</Link>
            </Button>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {[t("page.hero.s2"), t("page.hero.s3"), t("page.hero.s4")].map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-success" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div id="demo" className="relative mx-auto mt-16 max-w-6xl scroll-mt-20 sm:mt-20">
          <div className="pointer-events-none absolute -inset-x-10 -bottom-8 -top-8 -z-10 rounded-[3rem] bg-brand-gradient opacity-[0.045] blur-3xl" />
          <KnowledgeConsole />
        </div>

        <div className="mx-auto mt-6 max-w-6xl">
          <LiveStatus compact />
        </div>
      </div>
    </section>
  );
}
