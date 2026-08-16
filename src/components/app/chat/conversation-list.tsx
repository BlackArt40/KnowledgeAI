"use client";

// P7-5: conversation sidebar content (list + item + tag editor), extracted
// from the chat page. Items open the conversation on tap; the ⋯ menu
// (desktop hover / touch long-press) offers archive / tags / delete.
import * as React from "react";
import { Archive, MessageSquareText, MoreHorizontal, Plus, Search, Share2, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import { useLongPress } from "@/hooks/use-gestures";

export interface ConvLite {
  id: string;
  title: string;
  updatedAt: number;
  /** P4-1: shared conversations also appear in the team-shared group. */
  shared?: boolean;
  /** P5-3: archive state + tags for grouping. */
  archived?: boolean;
  tags?: string[];
}
export interface SharedConv {
  id: string;
  title: string;
  updatedAt: number;
  ownerName: string;
}

export function ConversationList({
  conversations,
  sharedConvs,
  convSearch,
  activeConv,
  archivedView,
  onToggleArchived,
  onSearchChange,
  onNew,
  onSelect,
  onDelete,
  onArchive,
  onTags,
}: {
  conversations: ConvLite[];
  sharedConvs: SharedConv[];
  convSearch: string;
  activeConv: string | null;
  archivedView: boolean;
  onToggleArchived: () => void;
  onSearchChange: (v: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onTags: (id: string) => void;
}) {
  const t = useT();
  const filteredConvs = conversations.filter((c) =>
    c.title.toLowerCase().includes(convSearch.trim().toLowerCase())
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Button variant="gradient" className="w-full justify-start" onClick={onNew}>
          <Plus className="h-4 w-4" /> {t("page.chat.s69")}
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={convSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("page.chat.s41")}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {/* P5-3: active / archived view toggle */}
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-muted/70 p-0.5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => archivedView && onToggleArchived()}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition-colors",
              !archivedView ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("page.chat.s10")}
          </button>
          <button
            type="button"
            onClick={() => !archivedView && onToggleArchived()}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition-colors",
              archivedView ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("page.chat.s78")}
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {filteredConvs.length === 0 && sharedConvs.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {convSearch ? t("page.chat.s42") : archivedView ? t("page.chat.s43") : t("page.chat.s44")}
          </p>
        )}
        {!archivedView && filteredConvs.length > 0 && (
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("page.chat.s10")}</p>
        )}
        {filteredConvs.map((c) => (
          <ConversationItem
            key={c.id}
            title={c.title}
            icon={<MessageSquareText className="h-3.5 w-3.5 shrink-0" />}
            meta={null}
            tags={c.tags}
            archived={c.archived}
            active={activeConv === c.id}
            onSelect={() => onSelect(c.id)}
            onDelete={() => onDelete(c.id)}
            onArchive={(a) => onArchive(c.id, a)}
            onTags={() => onTags(c.id)}
          />
        ))}
        {!archivedView && sharedConvs.length > 0 && (
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("page.chat.s11")}</p>
        )}
        {!archivedView && sharedConvs.map((c) => (
          <ConversationItem
            key={c.id}
            title={c.title}
            icon={<Share2 className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
            meta={<span className="shrink-0 text-[10px] text-muted-foreground">{c.ownerName}</span>}
            active={activeConv === c.id}
            onSelect={() => onSelect(c.id)}
            onDelete={() => onDelete(c.id)}
            onArchive={(a) => onArchive(c.id, a)}
            onTags={() => onTags(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

// One conversation row. Desktop shows the ⋯ menu on hover; touch devices get
// it via long-press (hover doesn't exist on phones). Menu: archive/restore,
// edit tags, delete.

function ConversationItem({
  title,
  icon,
  meta,
  tags,
  archived,
  active,
  onSelect,
  onDelete,
  onArchive,
  onTags,
}: {
  title: string;
  icon: React.ReactNode;
  meta: React.ReactNode;
  tags?: string[];
  archived?: boolean;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onArchive: (archived: boolean) => void;
  onTags: () => void;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  useLongPress(ref, () => setMenuOpen(true));

  return (
    <div className="relative">
      <div
        ref={ref}
        onClick={onSelect}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {tags && tags.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                  #{tag}
                </span>
              ))}
            </span>
          )}
        </span>
        {meta}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={cn(
            "shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-accent",
            active || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          aria-label={t("page.chat.s45")}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* P5-3: ⋯ menu (touch long-press + desktop hover). The fixed overlay
          closes it on any tap outside. */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-full z-30 mt-1 w-32 rounded-lg border border-border bg-card p-1 shadow-xl">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onArchive(!archived);
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <Archive className="h-3 w-3" /> {archived ? t("page.chat.s46") : t("page.chat.s47")}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onTags();
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <Tag className="h-3 w-3" /> {t("page.chat.s6")}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" /> {t("page.chat.s7")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// P5-3: tag editor for a conversation - chips + input (Enter / comma adds,
// × removes). Saved via PATCH /api/chat/conversations/[id] { tags }.

export function TagEditor({
  tags,
  onSave,
  onCancel,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState<string[]>(tags);
  const [input, setInput] = React.useState("");

  function addTag() {
    const t = input.trim().replace(/^#/, "");
    if (t && !draft.includes(t) && draft.length < 10) {
      setDraft((d) => [...d, t]);
    }
    setInput("");
  }

  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background p-2">
        {draft.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            #{tag}
            <button
              type="button"
              onClick={() => setDraft((d) => d.filter((x) => x !== tag))}
              className="text-primary/60 transition-colors hover:text-destructive"
              aria-label={t("page.chat.s58", { tag })}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
            if (e.key === "Backspace" && !input && draft.length > 0) {
              setDraft((d) => d.slice(0, -1));
            }
          }}
          placeholder={t("page.chat.s48")}
          className="h-6 min-w-24 flex-1 bg-transparent text-xs placeholder:text-muted-foreground focus-visible:outline-none"
        />
      </div>
      <DialogFooter className="mt-3">
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="gradient" onClick={() => onSave(draft)}>
          {t("page.chat.s79")}
        </Button>
      </DialogFooter>
    </div>
  );
}

// P5-1: citation sources panel, shared by the desktop xl sidebar and the
// mobile sheet.
