"use client";

// P7-5: chat answer citation sources panel, extracted from the chat page.
import * as React from "react";
import { FileText, Globe, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import type { Citation } from "@/lib/rag/types";

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

export function SourcesPanel({
  citations,
  highlightN,
  onCite,
}: {
  citations: Citation[];
  highlightN: number | null;
  onCite: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t("page.chat.s5")}</span>
        <Badge variant="secondary" className="ml-auto">
          {citations.length}
        </Badge>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {citations.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs text-muted-foreground">
            {t("page.chat.s80")}
          </p>
        ) : (
          citations.map((c) => {
            const isWeb = !!c.url;
            const host = isWeb ? hostOf(c.url!) : "";
            return (
              <button
                key={c.n}
                type="button"
                onClick={() => onCite(c.n)}
                className={cn(
                  "w-full rounded-xl border bg-card p-3 text-left transition-colors",
                  highlightN === c.n ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[11px] font-semibold text-primary">
                    {c.n}
                  </span>
                  {isWeb ? (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {isWeb ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="line-clamp-1 text-xs font-medium text-primary hover:underline"
                      title={c.url}
                    >
                      {c.docName}
                    </a>
                  ) : (
                    <span className="line-clamp-1 text-xs font-medium">{c.docName}</span>
                  )}
                </div>
                <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                  {c.snippet}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">
                    {isWeb ? `🌐 ${host}` : t("page.chat.s67", { idx: c.chunkIndex + 1 })}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {t("page.chat.s81", { pct: (c.score * 100).toFixed(0) })}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
