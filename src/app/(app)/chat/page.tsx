"use client";

import { useT, useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Brain,
  Send,
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Search,
  FileText,
  Sparkles,
  Library,
  MessageSquareText,
  Check,
  Trash2,
  Square,
  Download,
  Globe,
  Share2,
  MoreHorizontal,
  Archive,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatMarkdown } from "@/components/app/chat-markdown";
import { useIsMobile } from "@/hooks/use-media-query";
import { useHorizontalSwipe, useLongPress } from "@/hooks/use-gestures";
import { cn } from "@/lib/utils";
import { useSse } from "@/lib/use-sse";
import type { Citation } from "@/lib/rag/types";

interface KbLite {
  id: string;
  name: string;
  shared?: boolean;
  ownerName?: string;
  stats: { total: number; ready: number };
  /** P5-3: retrieval settings, used to widen topK when regenerating. */
  settings?: { topK: number };
}
interface ConvLite {
  id: string;
  title: string;
  updatedAt: number;
  /** P4-1: shared conversations also appear in the team-shared group. */
  shared?: boolean;
  /** P5-3: archive state + tags for grouping. */
  archived?: boolean;
  tags?: string[];
}
interface SharedConv {
  id: string;
  title: string;
  updatedAt: number;
  ownerName: string;
}
interface Msg {
  id: string;
  /** Server-side message id (assigned on `done`), used by the feedback API. */
  serverId?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  /** P5-3: like/dislike feedback, persisted server-side and consumed by the
   *  retrieval loop (down-weighting disliked citations). */
  feedback?: "up" | "down";
  feedbackNote?: string;
  followUps?: string[];
}

// Generic words to strip from page titles / URL host segments.
const STOPWORDS = new Set([
  "docs", "documentation", "overview", "home", "index", "readme",
  "api", "app", "platform", "ai", "python", "zh", "en", "www",
]);

// Pick the most meaningful segment from a hostname (the brand), skipping
// generic prefixes like docs/platform/python and the TLD.
function brandFromHost(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  // Prefer a non-generic segment; fall back to the second-level domain.
  const brand = parts.find((p) => p.length > 2 && !STOPWORDS.has(p.toLowerCase()));
  return brand || (parts.length >= 2 ? parts[parts.length - 2] : parts[0]);
}

// Extract the hostname (minus www.) from a URL for citation source labels.
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

// Words indicating a page failed to load (error / redirect / paywall).
const ERROR_TITLE = /(unavailable|redirect|not found|forbidden|denied|error|403|404|access|unavailable in region)/i;

// Derive a short topic label from a document (for example questions).
function docTopic(doc: { name: string; type: string; url?: string }): string {
  if (doc.type === "web" && doc.url) {
    const brand = (() => {
      try {
        return brandFromHost(new URL(doc.url).hostname);
      } catch {
        return "";
      }
    })();
    // Prefer the fetched page title when it is a meaningful title (not a bare
    // URL and not an error/redirect placeholder).
    const name = doc.name?.trim();
    if (name && !/^https?:\/\//i.test(name) && !ERROR_TITLE.test(name)) {
      const part = name.split(/[|｜\-–·]/).map((x) => x.trim()).find(Boolean) ?? name;
      const cleaned = part
        .replace(/\b(documentation|docs|overview|official|guide|tutorial)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) return cleaned;
    }
    // Fallback: derive the brand from the URL host.
    return brand || name || doc.url;
  }
  return (
    doc.name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]?v?\d+(\.\d+)*$/i, "")
      .replace(/[_\-]+/g, " ")
      .trim() || doc.name
  );
}

type TFunc = (k: string, vars?: Record<string, string | number>) => string;
const SUGGESTION_TEMPLATES = [
  (t: TFunc, x: string) => t("page.chat.s50", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s51", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s52", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s53", { topic: x }),
];

// derive-example-questions
// Build example questions from a KB's documents so the prompts stay relevant to
// the selected knowledge base instead of being hardcoded.
function kbSuggestions(
  docs: { name: string; type: string; url?: string; status: string }[],
  kbName: string,
  t: TFunc
): string[] {
  const ready = docs.filter((d) => d.status === "ready");
  if (ready.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let i = 0;
  for (const d of ready) {
    if (out.length >= 4) break;
    const topic = docTopic(d);
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    out.push(SUGGESTION_TEMPLATES[i % SUGGESTION_TEMPLATES.length](t, topic));
    i++;
  }
  if (out.length === 0) out.push(t("page.chat.s54", { name: kbName }));
  return out;
}

export default function ChatPage() {
  const t = useT();
  const { locale } = useI18n();
  const [kbs, setKbs] = React.useState<KbLite[]>([]);
  const [selectedKb, setSelectedKb] = React.useState<string>("");
  const [conversations, setConversations] = React.useState<ConvLite[]>([]);
  // P4-1: team-shared conversations (collaborative Q&A view).
  const [sharedConvs, setSharedConvs] = React.useState<SharedConv[]>([]);
  const [convSearch, setConvSearch] = React.useState("");
  // P5-3: archive view toggle - shows archived conversations instead of the
  // active ones (archived are hidden from the default list API-side).
  const [archivedView, setArchivedView] = React.useState(false);
  // P5-3: tag editing target (conversation being tagged).
  const [tagTarget, setTagTarget] = React.useState<{ id: string; title: string; tags: string[] } | null>(null);
  const [activeConv, setActiveConv] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false); // 联网搜索开关：开启后每次提问同时检索 web
  const [highlightN, setHighlightN] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  // P5-1: mobile-only sheets (conversation list / citation sources) and the
  // is-mobile flag that enables the swipe gestures.
  const isMobile = useIsMobile();
  const [convSheetOpen, setConvSheetOpen] = React.useState(false);
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  // P5-3: knowledge-base recommendations for the current conversation
  // (computed server-side from the last question's keyword overlap).
  const [recommendations, setRecommendations] = React.useState<
    { id: string; name: string; desc: string; matched: string[] }[]
  >([]);
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  // Monotonic counter so a stale send()'s finally() cannot clobber a newer
  // send's `sending` state after the user switches conversations mid-stream.
  const sendEpoch = React.useRef(0);
  // Holds a conversation ID from URL params (?conv=xxx) for deep-linking
  // from the dashboard. Cleared after the conversation is loaded.
  const pendingConvRef = React.useRef<string | null>(null);

  // load KBs — also reads ?kb= and ?conv= from the URL for deep-linking
  // (e.g. clicking a recent-QA item on the dashboard).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kbParam = params.get("kb");
    const convParam = params.get("conv");
    if (convParam) pendingConvRef.current = convParam;

    fetch("/api/knowledge-base", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ kbs }) => {
        setKbs(kbs);
        if (kbs.length && !selectedKb) {
          const kbFromUrl = kbParam ? kbs.find((k: KbLite) => k.id === kbParam) : null;
          setSelectedKb(kbFromUrl ? kbFromUrl.id : kbs[0].id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load conversations when KB changes
  React.useEffect(() => {
    if (!selectedKb) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveConv(null);
    setMessages([]);
    fetch(`/api/chat/conversations?kbId=${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ conversations }) => setConversations(conversations));
  }, [selectedKb]);

  // P4-1: team-shared conversations (span all KBs) - load once on mount.
  React.useEffect(() => {
    fetch("/api/chat/conversations/shared", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSharedConvs(d.conversations ?? []))
      .catch(() => setSharedConvs([]));
  }, []);

  // Generate example questions from the selected KB's documents so the prompts
  // reflect the current knowledge base.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedKb) { setSuggestions([]); return; }
    fetch(`/api/knowledge-base/${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSuggestions(kbSuggestions(d.docs ?? [], d.kb?.name ?? "", t)))
      .catch(() => setSuggestions([]));
  }, [selectedKb]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // P4-1: while viewing a team-shared conversation, stream new messages from
  // other members in real time (collaborative Q&A).
  const activeIsShared =
    activeConv !== null && sharedConvs.some((c) => c.id === activeConv);
  useSse(
    activeIsShared ? `/api/chat/conversations/${activeConv}/events` : "",
    (event) => {
      if (event?.type === "message" && event.message) {
        setMessages((m) => [...m, { ...event.message, streaming: false }]);
      }
    },
    { enabled: activeIsShared }
  );

  // P4-1: share/unshare the active conversation with the team.
  const activeIsMine = activeConv !== null && conversations.some((c) => c.id === activeConv);
  async function toggleShare() {
    if (!activeConv) return;
    await fetch(`/api/chat/conversations/${activeConv}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: !activeIsShared }),
    });
    refreshConversations();
    fetch("/api/chat/conversations/shared", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSharedConvs(d.conversations ?? []))
      .catch(() => setSharedConvs([]));
  }

  async function loadConversation(id: string) {
    if (abortStream()) refreshConversations();
    setActiveConv(id);
    // Close the mobile conversation sheet once a conversation is picked.
    setConvSheetOpen(false);
    const res = await fetch(`/api/chat/conversations/${id}`, { cache: "no-store" });
    const { conversation } = await res.json();
    setMessages(
      conversation.messages.map((m: Msg) => ({
        ...m,
        streaming: false,
        // Historical messages carry the server-side id directly.
        serverId: m.id,
      }))
    );
  }

  // Deep-link: if a conversation ID was passed via URL (?conv=xxx), load it
  // once the KB has been selected. Runs after the conversations-reset effect
  // so loadConversation's setActiveConv / setMessages override the reset.
  React.useEffect(() => {
    if (pendingConvRef.current && selectedKb && conversations.length >= 0) {
      const convId = pendingConvRef.current;
      pendingConvRef.current = null;
      // Small delay to let the conversations-reset effect complete first.
      setTimeout(() => loadConversation(convId), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKb, conversations]);

  function refreshConversations() {
    if (!selectedKb) return;
    fetch(`/api/chat/conversations?kbId=${selectedKb}${archivedView ? "&archived=1" : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ conversations }) => setConversations(conversations));
  }

  // P5-3: archive / restore + tags, then refresh the list.
  async function setArchive(id: string, archived: boolean) {
    await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    refreshConversations();
    if (activeConv === id && archived) {
      // Archiving the active conversation leaves the chat view.
      setActiveConv(null);
      setMessages([]);
    }
  }

  async function saveTags(id: string, tags: string[]) {
    await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    setTagTarget(null);
    refreshConversations();
  }

  // P5-3: recommend related knowledge bases after each question is answered,
  // based on keyword overlap between the question and other KBs.
  async function loadRecommendations(query: string) {
    if (!selectedKb) return;
    try {
      const res = await fetch(
        `/api/knowledge-base/recommend?q=${encodeURIComponent(query)}&excludeKbId=${selectedKb}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      setRecommendations(d.recommendations ?? []);
    } catch {
      setRecommendations([]);
    }
  }

  function newChat() {
    // If a stream is in-flight, abort it so it doesn't yank us back via
    // setActiveConv when it completes. Refresh the sidebar so the
    // (now server-saved) partial conversation appears.
    if (abortStream()) refreshConversations();
    setActiveConv(null);
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  async function removeConversation(id: string) {
    // Optimistic removal from the sidebar.
    setConversations((cs) => cs.filter((c) => c.id !== id));
    // If the deleted conversation was active, reset the view to a fresh chat.
    if (activeConv === id) {
      setActiveConv(null);
      setMessages([]);
    }
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
  }

  // Core streaming: POST the query and stream tokens into the assistant
  // message identified by aiMsgId. Shared by send() and regenerate().
  // Abort the in-flight stream (if any) without touching messages. Used when
  // the user switches away mid-stream so the old stream stops overwriting the
  // new view. The partial answer is already saved server-side.
  function abortStream() {
    if (!abortRef.current) return false;
    abortRef.current.abort();
    abortRef.current = null;
    setSending(false);
    return true;
  }

  // User-initiated stop: abort + mark the visible streaming message as done.
  function stopGeneration() {
    abortStream();
    setMessages((m) =>
      m.map((x) => (x.streaming ? { ...x, streaming: false } : x))
    );
  }

  async function streamAnswer(content: string, aiMsgId: string, epoch: number, opts?: { regenerate?: boolean }) {
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    // Chunk metadata from the `sources` event; used to build real-time
    // citations as [n] markers appear in the token stream.
    let sourceChunks: { docId: string; docName: string; chunkIndex: number; snippet: string; score: number; url?: string; sourceType?: string }[] = [];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kbId: selectedKb,
          query: content,
          conversationId: activeConv ?? undefined,
          webSearch,
          // P5-3: regenerate with different parameters (higher temperature +
          // wider retrieval) so the retry explores new ground server-side.
          ...(opts?.regenerate
            ? { regenerate: true, temperature: 0.7, topK: (selectedKbObj?.settings?.topK ?? 5) + 3 }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(t("page.chat.s12"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let convId = activeConv;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === "sources") {
            // Store chunk metadata for real-time citation rendering.
            sourceChunks = data.chunks ?? [];
          } else if (data.type === "token") {
            acc += data.text;
            // Real-time citation extraction: parse [n] markers from the
            // accumulated text and build citations from sourceChunks so the
            // reference panel updates live during streaming.
            const liveCites = extractLiveCitations(acc, sourceChunks);
            setMessages((m) =>
              m.map((x) =>
                x.id === aiMsgId
                  ? { ...x, content: acc, citations: liveCites.length > 0 ? liveCites : x.citations }
                  : x
              )
            );
          } else if (data.type === "done") {
            convId = data.conversationId;
            setMessages((m) =>
              m.map((x) =>
                x.id === aiMsgId
                  ? { ...x, content: acc, citations: data.citations, followUps: data.followUps, streaming: false, ...(data.messageId ? { serverId: data.messageId } : {}) }
                  : x
              )
            );
          }
        }
      }
      // Only switch to the new/updated conversation if the user hasn't
      // navigated away mid-stream (epoch guard).
      if (convId !== activeConv && sendEpoch.current === epoch) {
        setActiveConv(convId);
        refreshConversations();
      } else if (sendEpoch.current === epoch) {
        refreshConversations();
      }
    } catch (err: unknown) {
      // User-initiated abort: keep whatever partial content was already
      // streamed and mark the message as finished (not an error).
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        setMessages((m) =>
          m.map((x) =>
            x.id === aiMsgId
              ? { ...x, content: acc || t("page.chat.s13"), streaming: false }
              : x
          )
        );
      }
    } finally {
      abortRef.current = null;
    }
  }

  /** Parse [n] markers from accumulated text and map to sourceChunks for
   *  real-time citation rendering during streaming. The `n` in [n] is 1-based
   *  and maps to the retrieval order (sourceChunks[n-1]). */
  function extractLiveCitations(text: string, sources: { docId: string; docName: string; chunkIndex: number; snippet: string; score: number; url?: string; sourceType?: string }[]): Citation[] {
    if (sources.length === 0) return [];
    const seen = new Set<number>();
    const citations: Citation[] = [];
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > sources.length || seen.has(n)) continue;
      seen.add(n);
      const s = sources[n - 1];
      citations.push({ n, docId: s.docId, docName: s.docName, chunkIndex: s.chunkIndex, snippet: s.snippet, score: s.score, ...(s.url ? { url: s.url } : {}), ...(s.sourceType ? { sourceType: s.sourceType as Citation["sourceType"] } : {}) });
    }
    return citations;
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || !selectedKb || sending) return;
    setInput("");
    setSending(true);
    const userMsg: Msg = { id: `u_${Date.now()}`, role: "user", content };
    const aiMsg: Msg = { id: `a_${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);
    const epoch = ++sendEpoch.current;
    try {
      await streamAnswer(content, aiMsg.id, epoch);
    } finally {
      if (epoch === sendEpoch.current) setSending(false);
    }
  }

  // Regenerate the last answer: reuse the last user question, drop the
  // trailing assistant message, and stream a fresh answer with different
  // generation parameters (P5-3: temperature 0.7 + wider topK, sent via the
  // `regenerate` flag so the server also replaces the old answer in history).
  async function regenerate() {
    if (sending || !selectedKb) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const aiId = `a_${Date.now()}`;
    setMessages((m) => {
      const copy = [...m];
      if (copy[copy.length - 1]?.role === "assistant") copy.pop();
      copy.push({ id: aiId, role: "assistant", content: "", streaming: true });
      return copy;
    });
    const epoch = ++sendEpoch.current;
    setSending(true);
    try {
      await streamAnswer(lastUser.content, aiId, epoch, { regenerate: true });
      if (epoch === sendEpoch.current) loadRecommendations(lastUser.content);
    } finally {
      if (epoch === sendEpoch.current) setSending(false);
    }
  }

  // P5-3: like/dislike feedback persisted per-message (POST feedback API) and
  // read back when the conversation is loaded. Toggling off sends value=null.
  // The API targets the SERVER message id (serverId, assigned on `done`) -
  // the local id is a client-generated placeholder.
  async function submitFeedback(id: string, v: "up" | "down", note?: string) {
    setMessages((m) =>
      m.map((x) =>
        x.id === id
          ? x.feedback === v
            ? { ...x, feedback: undefined, feedbackNote: undefined }
            : { ...x, feedback: v, feedbackNote: note || undefined }
          : x
      )
    );
    const msg = messages.find((x) => x.id === id);
    const serverId = msg?.serverId;
    if (!serverId || !activeConv) return;
    const toggleOff = msg.feedback === v;
    await fetch(`/api/chat/conversations/${activeConv}/messages/${serverId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: toggleOff ? null : v, ...(note ? { note } : {}) }),
    }).catch(() => {});
  }

  // Export the current conversation as a Markdown file download. Includes
  // user/assistant messages, inline citations, and a reference list.
  function exportConversation(convId: string, msgs: Msg[], t: TFunc, locale: string) {
    const lines: string[] = [];
    lines.push(t("page.chat.s59"));
    lines.push("");
    lines.push(t("page.chat.s60", { time: new Date().toLocaleString(locale === "en" ? "en-US" : "zh-CN") }));
    lines.push(t("page.chat.s61", { id: convId }));
    lines.push("");
    lines.push("---");
    lines.push("");
    for (const m of msgs) {
      if (m.role === "user") {
        lines.push(t("page.chat.s62"));
        lines.push("");
        lines.push(m.content);
        lines.push("");
      } else {
        lines.push(t("page.chat.s63"));
        lines.push("");
        // Strip [n] markers for cleaner prose, but keep citation references.
        const cleanText = m.content.replace(/\[(\d+)\]/g, (_, n) => `[[${n}]](#ref-${n})`);
        lines.push(cleanText);
        lines.push("");
        if (m.citations && m.citations.length > 0) {
          lines.push(t("page.chat.s14"));
          lines.push("");
          for (const c of m.citations) {
            lines.push(t("page.chat.s66", { n: c.n, doc: c.docName, idx: c.chunkIndex + 1, pct: (c.score * 100).toFixed(0) }));
            lines.push(`  > ${c.snippet.replace(/\n/g, " ")}`);
          }
          lines.push("");
        }
        if (m.followUps && m.followUps.length > 0) {
          lines.push(t("page.chat.s15"));
          lines.push("");
          for (const f of m.followUps) {
            lines.push(`- ${f}`);
          }
          lines.push("");
        }
      }
      lines.push("---");
      lines.push("");
    }
    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${convId.slice(-8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const activeCitations =
    [...messages].reverse().find((m) => m.role === "assistant" && m.citations && m.citations.length > 0)?.citations ?? [];
  const selectedKbObj = kbs.find((k) => k.id === selectedKb);
  const filteredConvs = conversations.filter((c) =>
    c.title.toLowerCase().includes(convSearch.trim().toLowerCase())
  );

  // P5-1: swipe left/right on the message area to switch to the previous /
  // next conversation (mobile only; vertical scroll takes priority). Lives
  // after `filteredConvs` is derived so the swipe targets the visible list.
  useHorizontalSwipe(
    scrollRef,
    (dir) => {
      if (filteredConvs.length === 0) return;
      const idx = filteredConvs.findIndex((c) => c.id === activeConv);
      if (dir === "right" && idx > 0) loadConversation(filteredConvs[idx - 1].id);
      if (dir === "left" && idx >= 0 && idx < filteredConvs.length - 1) loadConversation(filteredConvs[idx + 1].id);
    },
    { enabled: isMobile }
  );

  return (
    <div className="chat-height flex gap-0 overflow-hidden rounded-2xl border border-border bg-card">
      {/* sessions - desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <ConversationList
          conversations={conversations}
          sharedConvs={sharedConvs}
          convSearch={convSearch}
          activeConv={activeConv}
          archivedView={archivedView}
          onToggleArchived={() => {
            setArchivedView((v) => !v);
            setActiveConv(null);
            setMessages([]);
          }}
          onSearchChange={setConvSearch}
          onNew={() => newChat()}
          onSelect={(id) => loadConversation(id)}
          onDelete={(id) => setConfirmDeleteId(id)}
          onArchive={(id, archived) => setArchive(id, archived)}
          onTags={(id) => {
            const c = conversations.find((x) => x.id === id);
            setTagTarget({ id, title: c?.title ?? t("page.chat.s16"), tags: c?.tags ?? [] });
          }}
        />
      </aside>

      {/* sessions - mobile sheet (P5-1: the sidebar is hidden below md, so
          the drawer is the only way to switch conversations on phones) */}
      <Sheet open={convSheetOpen} onOpenChange={setConvSheetOpen}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">{t("page.chat.s0")}</SheetTitle>
          <SheetClose
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            aria-label={t("page.chat.s17")}
          >
            <X className="h-4 w-4" />
          </SheetClose>
          <ConversationList
            conversations={conversations}
            sharedConvs={sharedConvs}
            convSearch={convSearch}
            activeConv={activeConv}
            archivedView={archivedView}
            onToggleArchived={() => {
              setArchivedView((v) => !v);
              setActiveConv(null);
              setMessages([]);
            }}
            onSearchChange={setConvSearch}
            onNew={() => { newChat(); setConvSheetOpen(false); }}
            onSelect={(id) => loadConversation(id)}
            onDelete={(id) => setConfirmDeleteId(id)}
            onArchive={(id, archived) => setArchive(id, archived)}
            onTags={(id) => {
              const c = conversations.find((x) => x.id === id);
              setTagTarget({ id, title: c?.title ?? t("page.chat.s16"), tags: c?.tags ?? [] });
            }}
          />
        </SheetContent>
      </Sheet>

      {/* chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* header / kb selector */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-3 sm:px-4">
          {/* P5-1: conversation drawer trigger (desktop has the sidebar) */}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 md:hidden"
            onClick={() => setConvSheetOpen(true)}
            aria-label={t("page.chat.s0")}
          >
            <MessageSquareText className="h-4 w-4" />
          </Button>
          {kbs.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("page.chat.s1")}</span>
          ) : (
            <Select value={selectedKb} onValueChange={setSelectedKb}>
              <SelectTrigger className="h-9 min-w-0 flex-1 gap-2 sm:w-[220px] sm:flex-none">
                <Library className="h-4 w-4 shrink-0 text-primary" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kbs.map((kb) => (
                  <SelectItem key={kb.id} value={kb.id}>
                    {kb.name} · {kb.stats.ready} 篇就绪{kb.shared ? t("page.chat.s57", { name: kb.ownerName ?? "" }) : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedKbObj && (
            <Badge variant="success" className="ml-auto hidden md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {selectedKbObj.stats.ready} 篇可检索
            </Badge>
          )}
          {/* P5-1: citation sources drawer trigger (desktop panel is xl-only).
              Below md the readiness badge is hidden, so this keeps ml-auto to
              sit right-aligned; from md up the badge takes the ml-auto slot. */}
          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:ml-0 xl:hidden"
            aria-label={t("page.chat.s5")}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("page.chat.s2")}</span>
          </button>
          {activeConv && messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="ml-2 h-8 gap-1.5"
              onClick={() => exportConversation(activeConv, messages, t, locale)}
              aria-label={t("page.chat.s18")}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("page.chat.s3")}</span>
            </Button>
          )}
          {activeIsMine && (
            <Button
              variant="outline"
              size="sm"
              className={cn("ml-2 h-8 gap-1.5", activeIsShared && "border-sky-500/40 text-sky-600")}
              onClick={toggleShare}
              aria-label={activeIsShared ? t("page.chat.s19") : t("page.chat.s20")}
              title={activeIsShared ? t("page.chat.s21") : t("page.chat.s22")}
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{activeIsShared ? t("page.chat.s23") : t("page.chat.s24")}</span>
            </Button>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <EmptyState onPick={send} kbReady={!!selectedKbObj?.stats.ready} suggestions={suggestions} />
          ) : (
            messages.map((m, i) => {
              // Render follow-up suggestions after the last assistant message
              // (when it's done streaming and has followUps).
              const isLastAssistant =
                m.role === "assistant" && !m.streaming &&
                i === messages.length - 1 && m.followUps && m.followUps.length > 0;
              return (
                <React.Fragment key={m.id}>
                  <MessageBubble
                    msg={m}
                    onCite={(n) => setHighlightN(n)}
                    onRegenerate={regenerate}
                    onFeedback={(v, note) => submitFeedback(m.id, v, note)}
                  />
                  {isLastAssistant && (
                    <FollowUpSuggestions
                      suggestions={m.followUps!}
                      onPick={(q) => send(q)}
                    />
                  )}
                </React.Fragment>
              );
            })
          )}
          {/* P5-3: related knowledge-base recommendations for this conversation */}
          {messages.length > 0 && recommendations.length > 0 && (
            <div className="pl-1 sm:pl-11">
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> 相关知识库推荐
                </p>
                <div className="mt-2 space-y-1.5">
                  {recommendations.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedKb(r.id);
                        setRecommendations([]);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40"
                    >
                      <Library className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{r.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.desc || t("page.chat.s25")}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {r.matched.join("、")}匹配
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* input */}
        <div className="border-t border-border p-3 sm:p-4">
          <div className="mb-2 flex items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => setWebSearch((v) => !v)}
              aria-pressed={webSearch}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                webSearch
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
              title={webSearch ? t("page.chat.s26") : t("page.chat.s27")}
            >
              <Globe className="h-3.5 w-3.5" />
              联网搜索
            </button>
            {webSearch && (
              <span className="text-[11px] text-muted-foreground">{t("page.chat.s4")}</span>
            )}
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Ignore Enter while an IME (e.g. Chinese pinyin) is composing:
                // that Enter confirms the candidate, it must not send the message.
                // isComposing (standard) + keyCode 229 (legacy fallback) together
                // cover all browsers / input methods.
                const composing = e.nativeEvent.isComposing || e.keyCode === 229;
                if (e.key === "Enter" && !e.shiftKey && !composing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={selectedKbObj ? t("page.chat.s55", { extra: webSearch ? t("page.chat.s25") : "" }) : t("page.chat.s56")}
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
            {sending ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={stopGeneration}
                aria-label={t("page.chat.s30")}
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                variant="gradient"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => send()}
                disabled={!input.trim() || !selectedKb}
                aria-label={t("page.chat.s31")}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* sources - desktop panel (xl+) */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-muted/30 xl:flex">
        <SourcesPanel
          citations={activeCitations}
          highlightN={highlightN}
          onCite={(n) => setHighlightN(n)}
        />
      </aside>

      {/* sources - mobile sheet (P5-1: the desktop panel is xl-only) */}
      <Sheet open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <SheetContent side="right" className="p-0">
          <SheetTitle className="sr-only">{t("page.chat.s5")}</SheetTitle>
          <SheetClose
            className="absolute left-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            aria-label={t("page.chat.s32")}
          >
            <X className="h-4 w-4" />
          </SheetClose>
          <SourcesPanel
            citations={activeCitations}
            highlightN={highlightN}
            onCite={(n) => setHighlightN(n)}
          />
        </SheetContent>
      </Sheet>

      {/* P5-3: conversation tag editor */}
      <Dialog
        open={tagTarget !== null}
        onOpenChange={(o) => { if (!o) setTagTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("page.chat.s6")}</DialogTitle>
            <DialogDescription>
              为会话「{tagTarget?.title ?? ""}」添加标签，便于分类查找。
            </DialogDescription>
          </DialogHeader>
          {tagTarget && (
            <TagEditor
              tags={tagTarget.tags}
              onSave={(tags) => saveTags(tagTarget.id, tags)}
              onCancel={() => setTagTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* delete conversation confirmation */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("page.chat.s7")}</DialogTitle>
            <DialogDescription>
              确定删除此会话？该会话的所有消息将被永久删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (confirmDeleteId) await removeConversation(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> 删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onPick, kbReady, suggestions }: { onPick: (q: string) => void; kbReady: boolean; suggestions: string[] }) {
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

function MessageBubble({
  msg,
  onCite,
  onRegenerate,
  onFeedback,
}: {
  msg: Msg;
  onCite: (n: number) => void;
  onRegenerate?: () => void;
  onFeedback?: (v: "up" | "down", note?: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  // P5-3: dislike opens an inline note field (persisted alongside the vote).
  // A ref mirrors the input so the submit handler always reads the latest
  // value even if React hasn't flushed the controlled-state update yet.
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const noteRef = React.useRef("");
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
        <Brain className="h-4 w-4" />
      </span>
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-3 text-sm leading-relaxed">
          {/* P5-3: full Markdown rendering (code blocks with highlight + copy,
              tables, mermaid chip flows) on top of the [n] citation chips. */}
          <ChatMarkdown text={msg.content} onCite={onCite} />
          {msg.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
          )}
        </div>
        {!msg.streaming && msg.content && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
            <ActionBtn
              icon={copied ? Check : Copy}
              label={copied ? t("page.chat.s35") : t("page.chat.s36")}
              onClick={() => {
                navigator.clipboard?.writeText(msg.content.replace(/\[\d+\]/g, ""));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            <ActionBtn icon={RefreshCw} label={t("page.chat.s37")} onClick={onRegenerate} />
            <ActionBtn icon={ThumbsUp} label={t("page.chat.s38")} active={msg.feedback === "up"} onClick={() => onFeedback?.("up")} />
            <ActionBtn
              icon={ThumbsDown}
              label={t("page.chat.s39")}
              active={msg.feedback === "down"}
              onClick={() => {
                if (msg.feedback === "down") { onFeedback?.("down"); return; }
                setNoteOpen(true);
              }}
            />
            {noteOpen && (
              <div className="flex w-full items-center gap-1.5 pt-0.5">
                <input
                  autoFocus
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    noteRef.current = e.target.value;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onFeedback?.("down", noteRef.current.trim());
                      setNoteOpen(false);
                      setNote("");
                      noteRef.current = "";
                    }
                  }}
                  placeholder={t("page.chat.s40")}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    onFeedback?.("down", noteRef.current.trim());
                    setNoteOpen(false);
                    setNote("");
                    noteRef.current = "";
                  }}
                  className="h-8 rounded-lg bg-brand-gradient px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  提交
                </button>
                <button
                  type="button"
                  onClick={() => { setNoteOpen(false); setNote(""); noteRef.current = ""; }}
                  className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// render text with [n] markers as clickable citation chips
function RichText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          return (
            <button
              key={i}
              onClick={() => onCite(Number(m[1]))}
              className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {m[1]}
            </button>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

// Follow-up question suggestions shown after the last assistant message.
// Clicking a suggestion sends it as the next user query.
function FollowUpSuggestions({
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
        <Sparkles className="h-3 w-3" /> 追问建议
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
function ConversationList({
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
          <Plus className="h-4 w-4" /> 新建会话
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
            我的会话
          </button>
          <button
            type="button"
            onClick={() => !archivedView && onToggleArchived()}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition-colors",
              archivedView ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            已归档
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
              <Tag className="h-3 w-3" /> 编辑标签
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
              <Trash2 className="h-3 w-3" /> 删除会话
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// P5-3: tag editor for a conversation - chips + input (Enter / comma adds,
// × removes). Saved via PATCH /api/chat/conversations/[id] { tags }.
function TagEditor({
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
          取消
        </Button>
        <Button variant="gradient" onClick={() => onSave(draft)}>
          保存标签
        </Button>
      </DialogFooter>
    </div>
  );
}

// P5-1: citation sources panel, shared by the desktop xl sidebar and the
// mobile sheet.
function SourcesPanel({
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
            AI 回答的引用来源将显示在此处
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
                    相似度 {(c.score * 100).toFixed(0)}%
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
