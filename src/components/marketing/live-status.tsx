"use client";

import * as React from "react";
import { Activity, Database, RadioTower, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { toReadinessPulse, type ReadinessPayload, type ReadinessPulse } from "@/lib/marketing/readiness";
import { cn } from "@/lib/utils";

const CHECK_ICONS = {
  db: Database,
  redis: RadioTower,
  llm: Sparkles,
} as const;

export function LiveStatus({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [pulse, setPulse] = React.useState<ReadinessPulse>({
    state: "offline",
    checks: [],
  });
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetch("/api/health/ready", { cache: "no-store" });
        if (!active) return;
        setPulse(toReadinessPulse((await res.json()) as ReadinessPayload));
      } catch {
        if (active) setPulse(toReadinessPulse(null));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const state = loading ? "checking" : pulse.state;
  const label =
    state === "online"
      ? t("page.hero.s28")
      : state === "degraded"
        ? t("page.hero.s29")
        : state === "offline"
          ? t("page.hero.s30")
          : t("page.hero.s27");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/80 bg-card/75 backdrop-blur-xl",
        compact ? "px-4 py-3" : "p-4 sm:p-5",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Activity className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("page.hero.s26")}
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PerformanceDot state={state} />
            {label}
          </div>
        </div>
        {!compact && (
          <div className="ml-auto grid grid-cols-3 gap-2">
            {(["db", "redis", "llm"] as const).map((name) => {
              const check = pulse.checks.find((item) => item.name === name);
              const Icon = CHECK_ICONS[name];
              return (
                <div
                  key={name}
                  className="min-w-20 rounded-xl border border-border/70 bg-background/60 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    {name}
                  </div>
                  <div className="mt-1 text-xs font-medium">
                    {check?.status === "degraded"
                      ? t("page.hero.s29")
                      : typeof check?.latencyMs === "number"
                        ? `${check.latencyMs} ms`
                        : check?.status === "ok"
                          ? t("page.hero.s33")
                          : t("page.hero.s27")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceDot({ state }: { state: "online" | "degraded" | "offline" | "checking" }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-2 w-2 rounded-full",
        state === "online" && "bg-success",
        state === "degraded" && "bg-warning",
        state === "offline" && "bg-destructive",
        state === "checking" && "bg-muted-foreground",
      )}
    >
      {state === "online" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
      )}
    </span>
  );
}
