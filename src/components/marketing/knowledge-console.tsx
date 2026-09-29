"use client";

import * as React from "react";
import { Bot, Check, FileText, FolderUp, MessageSquareText, Search } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type ConsoleMode = "ask" | "ingest" | "research";

const MODES: { id: ConsoleMode; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "ask", icon: MessageSquareText },
  { id: "ingest", icon: FolderUp },
  { id: "research", icon: Bot },
];

export function KnowledgeConsole() {
  const t = useT();
  const [mode, setMode] = React.useState<ConsoleMode>("ask");

  const label = (id: ConsoleMode) =>
    id === "ask"
      ? t("page.hero.s15")
      : id === "ingest"
        ? t("page.features.s12")
        : t("page.features.s9");

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/90 shadow-2xl shadow-black/[0.06] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          KnowledgeAI · {t("page.hero.s22")}
        </span>
      </div>

      <div className="p-4 sm:p-6">
        <div className="mx-auto flex max-w-xl gap-1 rounded-2xl border border-border/70 bg-muted/30 p-1">
          {MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                mode === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label(id)}
            </button>
          ))}
        </div>

        <div className="mt-5 min-h-[260px]">
          {mode === "ask" && <AskPreview />}
          {mode === "ingest" && <IngestPreview />}
          {mode === "research" && <ResearchPreview />}
        </div>
      </div>
    </div>
  );
}

function AskPreview() {
  const t = useT();
  const sources = [
    { title: t("page.hero.s5"), page: t("page.hero.s6") },
    { title: t("page.hero.s7"), page: t("page.hero.s8") },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {t("page.hero.s17")}
        </div>
      </div>
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
          <Bot className="h-4 w-4" />
        </span>
        <div className="rounded-2xl rounded-tl-md border border-border/70 bg-background/80 px-4 py-3 text-sm leading-relaxed">
          {t("page.hero.s18")}
          <span className="ml-2 inline-flex gap-1 align-baseline">
            <Cite n={1} />
            <Cite n={2} />
          </span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <div key={source.title} className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 p-3">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{source.title}</div>
              <div className="text-[10px] text-muted-foreground">{source.page}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IngestPreview() {
  const t = useT();
  const files = ["PDF", "DOCX", "MARKDOWN"];

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.03] px-5 py-7 text-center">
        <FolderUp className="mx-auto h-6 w-6 text-primary" />
        <div className="mt-2 text-sm font-medium">{t("page.hero.s24")}</div>
      </div>
      {files.map((file, index) => (
        <div key={file} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-4 py-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">{file}</span>
          <div className="ml-auto h-1.5 w-28 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${100 - index * 18}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResearchPreview() {
  const t = useT();
  const steps = [t("page.dashboard.s4"), t("page.dashboard.s5"), t("page.dashboard.s7")];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-primary" />
          {t("page.features.s9")}
        </div>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center gap-3 rounded-xl bg-muted/25 px-3 py-2.5">
              <span className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold",
                index < 2 ? "bg-primary text-primary-foreground" : "border border-border bg-background",
              )}>
                {index < 2 ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className="text-xs font-medium">{step}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {index < 2 ? t("page.features.s0") : t("page.features.s27")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary align-baseline">
      {n}
    </span>
  );
}
