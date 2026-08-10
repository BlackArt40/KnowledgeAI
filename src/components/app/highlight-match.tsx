"use client";
// P5-2: highlight occurrences of the query terms inside a text string.
// Splits on space so multi-word queries highlight each term; renders the
// matches as <mark> (styled via globals' default mark styles / Tailwind
// classes passed through className).
import * as React from "react";

export function HighlightMatch({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0 || !text) return <>{text}</>;

  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    // find the earliest match of any term at or after i
    let best = -1;
    let bestLen = 0;
    for (const term of terms) {
      const idx = lower.indexOf(term, i);
      if (idx >= 0 && (best === -1 || idx < best)) {
        best = idx;
        bestLen = term.length;
      }
    }
    if (best === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (best > i) parts.push(text.slice(i, best));
    parts.push(
      <mark key={best} className={className ?? "rounded bg-primary/20 px-0.5 text-primary"}>
        {text.slice(best, best + bestLen)}
      </mark>
    );
    i = best + bestLen;
  }
  return <>{parts}</>;
}
