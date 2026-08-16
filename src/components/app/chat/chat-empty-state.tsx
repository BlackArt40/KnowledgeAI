"use client";

// P7-5: chat empty state + follow-up suggestion chips, extracted from the
// chat page.
import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";

export function EmptyState({ onPick, kbReady, suggestions }: { onPick: (q: string) => void; kbReady: boolean; suggestions: string[] }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-lg shadow-primary/30">
        <Sparkles className="h-7 w-7" />
      </span>
      <h3 className="mt-5 text-lg font-semibold">{t("page.chat.s8")}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {kbReady
          ? t("page.chat.s33")
          : t("page.chat.s34")}
      </p>
      {kbReady && (
        <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {!kbReady && (
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/knowledge-base">{t("page.chat.s9")}</Link>
        </Button>
      )}
    </div>
  );
}

// Follow-up question suggestions shown after the last assistant message.
// Clicking a suggestion sends it as the next user query.

export function FollowUpSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (q: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 pl-11">
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" /> {t("page.chat.s82")}
      </span>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onPick(s)}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// P5-3: conversation sidebar content, shared by the desktop sidebar and the
// mobile sheet. Items open the conversation on tap; the ⋯ menu (desktop
// hover / touch long-press) offers archive / tags / delete.
