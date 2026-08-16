"use client";

import { useT } from "@/lib/i18n/provider";

import Link from "next/link";
import { Wrench, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function MaintenancePage() {
  const t = useT();
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-warning/20 blur-[100px]" />

      <Logo />

      <div className="relative mt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-warning/10">
          <Wrench className="h-10 w-10 text-warning" />
        </div>
        <h1 className="mt-6 text-2xl font-bold">{t("page.maintenance.s0")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("page.maintenance.s4")}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>{t("page.maintenance.s1")}</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" asChild>
          <a href="mailto:support@knowledgeai.dev"><Mail className="h-4 w-4" />{t("page.maintenance.s2")}</a>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/">{t("page.maintenance.s3")}</Link>
        </Button>
      </div>
    </div>
  );
}
