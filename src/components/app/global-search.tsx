"use client";

import { useT } from "@/lib/i18n/provider";
// P5-2: Cmd+K global search panel. Queries GET /api/search once (all
// categories in one response), then the tabs filter client-side. Features:
// debounced input, keyboard navigation (↑/↓/Enter/Esc), query highlighting,
// recent searches (localStorage) and quick actions when the input is empty.
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Library,
  FileText,
  MessageSquareText,
  Bot,
  Settings,
  ChevronRight,
  Clock,
  Plus,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightMatch } from "@/components/app/highlight-match";
import { cn } from "@/lib/utils";

interface SearchResults {
  kbs: { id: string; name: string; desc: string; ownerName: string; shared: boolean; updatedAt: number }[];
  docs: { id: string; kbId: string; kbName: string; name: string; type: string; status: string; url?: string; uploadedAt: number }[];
  conversations: { id: string; kbId: string; title: string; shared?: boolean; updatedAt: number }[];
  tasks: { id: string; topic: string; kbName?: string; status: string; updatedAt: number }[];
  settings: { id: string; label: string; href: string }[];
}

type TabKey = "all" | "kbs" | "docs" | "conversations" | "tasks" | "settings";

function tabs(t: (k: string) => string): { key: TabKey; label: string }[] {
  return [
    { key: "all", label: t("page.global-search.s2") },
    { key: "kbs", label: t("page.global-search.s3") },
    { key: "docs", label: t("page.global-search.s4") },
    { key: "conversations", label: t("page.global-search.s5") },
    { key: "tasks", label: "Agent" },
    { key: "settings", label: t("page.global-search.s6") },
  ];
}

function taskStatusLabel(t: (k: string) => string): Record<string, string> {
  return {
    queued: t("page.global-search.s7"), running: t("page.global-search.s8"), done: t("page.global-search.s9"), failed: t("page.global-search.s10"),
  };
}

const TYPE_TO_TAB: Record<"kb" | "doc" | "conv" | "task" | "setting", TabKey> = {
  kb: "kbs", doc: "docs", conv: "conversations", task: "tasks", setting: "settings",
};

interface FlatItem {
  id: string;
  type: "kb" | "doc" | "conv" | "task" | "setting";
  title: string;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const RECENT_KEY = "kai-recent-search";
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(terms: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(terms.slice(0, RECENT_MAX)));
  } catch { /* quota / private mode */ }
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>("all");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset the panel state each time it opens.
  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting on open is the point of this effect
      setQuery("");
      setResults(null);
      setTab("all");
      setActiveIdx(0);
      setRecent(loadRecent());
      // Radix Dialog focuses the content; move focus into the input after
      // the dialog is mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    abortRef.current?.abort();
  }, [open]);

  // Debounced search (250ms) with abort of stale requests.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query empties is the point of this effect
      setResults(null);
      setLoading(false);
      setActiveIdx(0);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (res.ok) {
          const d = await res.json();
          setResults(d.results);
          setActiveIdx(0);
        }
      } catch { /* aborted or network */ }
      finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Flatten the current tab's rows for rendering + keyboard navigation.
  const flat = React.useMemo<FlatItem[]>(() => {
    if (!results) return [];
    const all: FlatItem[] = [
      ...results.kbs.map((kb) => ({
        id: kb.id,
        type: "kb" as const,
        title: kb.name,
        subtitle: kb.desc || (kb.shared ? t("page.global-search.s11", { name: kb.ownerName }) : t("page.global-search.s12")),
        href: `/knowledge-base/${kb.id}`,
        icon: Library,
      })),
      ...results.docs.map((d) => ({
        id: d.id,
        type: "doc" as const,
        title: d.name,
        subtitle: `${d.kbName} · ${d.status === "ready" ? t("page.global-search.s13") : d.status === "failed" ? t("page.global-search.s14") : t("page.global-search.s15")}`,
        href: `/knowledge-base/${d.kbId}`,
        icon: FileText,
      })),
      ...results.conversations.map((c) => ({
        id: c.id,
        type: "conv" as const,
        title: c.title,
        subtitle: c.shared ? t("page.global-search.s11") : t("page.global-search.s5"),
        href: `/chat?kb=${c.kbId}&conv=${c.id}`,
        icon: MessageSquareText,
      })),
      ...results.tasks.map((tk) => ({
        id: tk.id,
        type: "task" as const,
        title: tk.topic,
        subtitle: (tk.kbName ? `${tk.kbName} · ` : "") + (taskStatusLabel(t)[tk.status] ?? tk.status),
        href: `/agent?task=${tk.id}`,
        icon: Bot,
      })),
      ...results.settings.map((s) => ({
        id: s.id,
        type: "setting" as const,
        title: s.label,
        subtitle: t("page.global-search.s6"),
        href: s.href,
        icon: Settings,
      })),
    ];
    return tab === "all" ? all : all.filter((i) => TYPE_TO_TAB[i.type] === tab);
  }, [results, tab, t]);

  function go(item: FlatItem) {
    onOpenChange(false);
    router.push(item.href);
    // Remember the query (not the item) as a recent search.
    const q = query.trim();
    if (q) setRecent((prev) => {
      const next = [q, ...prev.filter((p) => p !== q)].slice(0, RECENT_MAX);
      saveRecent(next);
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIdx];
      if (item) go(item);
    } else if (e.key === "Escape" && query) {
      // First Escape clears the query instead of closing the panel.
      e.stopPropagation();
      setQuery("");
    }
  }

  const empty = query.trim() === "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keyboard navigation lives on the panel container so it keeps working
          no matter which element inside has focus (tab buttons, results). */}
      <DialogContent
        onKeyDown={onKeyDown}
        className="top-[10%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:top-[15%]"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("page.global-search.s0")}</DialogTitle>

        {/* input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.global-search.s12")}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {loading && (
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary" />
          )}
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            ESC
          </kbd>
        </div>

        {/* category tabs */}
        <Tabs value={tab} onValueChange={(v) => { setTab(v as TabKey); setActiveIdx(0); }}>
          <div className="border-b border-border px-3 py-2">
            <TabsList>
              {tabs(t).map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="px-2.5 py-1 text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>

        {/* results / recent / quick actions */}
        <div className="max-h-80 min-h-24 overflow-y-auto p-2">
          {empty ? (
            <>
              {recent.length > 0 && (
                <div className="p-1">
                  <p className="flex items-center gap-1 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="h-3 w-3" /> {t("page.global-search.s22")}
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-2 pb-1">
                    {recent.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setQuery(r)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-border p-1 pt-2">
                <p className="flex items-center gap-1 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> {t("page.global-search.s23")}
                </p>
                <QuickAction icon={Plus} label={t("page.global-search.s19")} hint={t("page.global-search.s20")} href="/knowledge-base?new=1" onGo={() => { onOpenChange(false); router.push("/knowledge-base?new=1"); }} />
                <QuickAction icon={MessageSquareText} label={t("page.global-search.s21")} hint={t("page.global-search.s16")} href="/chat" onGo={() => { onOpenChange(false); router.push("/chat"); }} />
                <QuickAction icon={Bot} label={t("page.global-search.s17")} hint={t("page.global-search.s18")} href="/agent" onGo={() => { onOpenChange(false); router.push("/agent"); }} />
              </div>
            </>
          ) : loading && !results ? (
            <p className="py-10 text-center text-xs text-muted-foreground">{t("page.global-search.s1")}</p>
          ) : flat.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">{t("page.global-search.s24", { query: query.trim() })}</p>
          ) : (
            <ul className="space-y-0.5">
              {flat.map((item, i) => (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => go(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      i === activeIdx ? "bg-primary/10" : "hover:bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        item.type === "task" ? "bg-violet-500/10 text-violet-500" : "bg-primary/10 text-primary"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        <HighlightMatch text={item.title} query={query.trim()} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuickAction({
  icon: Icon,
  label,
  hint,
  onGo,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  href: string;
  onGo: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onGo}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
