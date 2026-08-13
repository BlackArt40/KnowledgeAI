"use client";

import { useT, useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import {
  Send,
  Search,
  Sparkles,
  Library,
  MessageSquareText,
  Trash2,
  Square,
  Download,
  Globe,
  Share2,
  X,
  Mic,
  ImagePlus,
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
import { MessageBubble } from "@/components/app/chat/message-bubble";
import { ConversationList, TagEditor, type ConvLite, type SharedConv } from "@/components/app/chat/conversation-list";
import { SourcesPanel } from "@/components/app/chat/sources-panel";
import { EmptyState, FollowUpSuggestions } from "@/components/app/chat/chat-empty-state";
import { useIsMobile } from "@/hooks/use-media-query";
import { useHorizontalSwipe, useLongPress } from "@/hooks/use-gestures";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { cn } from "@/lib/utils";
import { useSse } from "@/lib/use-sse";
import { consumeSseStream } from "@/lib/sse";
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
// Words indicating a page failed to load (error / redirect / paywall).
const ERROR_TITLE = /(unavailable|redirect|not found|forbidden|denied|error|403|404|access|unavailable in region)/i;

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
  // P7-4: image attachments (base64) sent with the next question.
  const [attachments, setAttachments] = React.useState<{ mime: string; data: string; name: string }[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
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
  // P7-4: voice input - final transcript auto-sends the question.
  const {
    listening,
    interim: sttInterim,
    supported: sttSupported,
    start: sttStart,
    stop: sttStop,
  } = useSpeechRecognition({
    onFinalText: (text) => send(text),
    onError: () => {},
  });
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

  async function streamAnswer(
    content: string,
    aiMsgId: string,
    epoch: number,
    opts?: { regenerate?: boolean; images?: { mime: string; data: string; name: string }[] }
  ) {
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
          // P7-4: multimodal - send image attachments (base64) with the question.
          ...(opts?.images && opts.images.length > 0
            ? { images: opts.images.map(({ mime, data }) => ({ mime, data })) }
            : {}),
          // P5-3: regenerate with different parameters (higher temperature +
          // wider retrieval) so the retry explores new ground server-side.
          ...(opts?.regenerate
            ? { regenerate: true, temperature: 0.7, topK: (selectedKbObj?.settings?.topK ?? 5) + 3 }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(t("page.chat.s12"));

      // 共享 SSE 帧解析（src/lib/sse.ts）——事件名/帧格式只在一处维护。
      let convId = activeConv;
      await consumeSseStream(res, (data) => {
        if (data.type === "sources") {
          // Store chunk metadata for real-time citation rendering.
          sourceChunks = data.chunks as typeof sourceChunks;
        } else if (data.type === "token") {
          acc += (data.text as string) ?? "";
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
          convId = data.conversationId as string;
          setMessages((m) =>
            m.map((x) =>
              x.id === aiMsgId
                ? { ...x, content: acc, citations: data.citations as Citation[] | undefined, followUps: data.followUps as string[] | undefined, streaming: false, ...(data.messageId ? { serverId: data.messageId as string } : {}) }
                : x
              )
            );
        }
      });
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
    const withImages = attachments.length > 0 ? attachments : undefined;
    setInput("");
    setAttachments([]);
    setSending(true);
    const userMsg: Msg = { id: `u_${Date.now()}`, role: "user", content };
    const aiMsg: Msg = { id: `a_${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);
    const epoch = ++sendEpoch.current;
    try {
      await streamAnswer(content, aiMsg.id, epoch, { images: withImages });
    } finally {
      if (epoch === sendEpoch.current) setSending(false);
    }
  }

  // P7-4: pick image attachments (max 4) and read them as base64.
  function pickImages(files: FileList | null) {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 4 - attachments.length);
    for (const f of list) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result ?? "").split(",")[1] ?? "";
        if (data) {
          setAttachments((prev) => [...prev, { mime: f.type || "image/png", data, name: f.name }]);
        }
      };
      reader.readAsDataURL(f);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          {/* P7-4: image attachment previews */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {attachments.map((img, i) => (
                <div key={i} className="group relative">
                  <img
                    src={`data:${img.mime};base64,${img.data}`}
                    alt={img.name}
                    className="h-16 w-16 rounded-lg border border-border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t("page.chat.s64")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            {/* P7-4: attach image */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pickImages(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("page.chat.s65")}
              title={t("page.chat.s65")}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            {/* P7-4: voice input (Web Speech API) */}
            {sttSupported && (
              <Button
                type="button"
                variant={listening ? "destructive" : "ghost"}
                size="icon"
                className={cn("h-9 w-9 shrink-0", listening ? "animate-pulse" : "text-muted-foreground")}
                onClick={() => (listening ? sttStop() : sttStart())}
                aria-label={t("page.chat.s66")}
                title={t("page.chat.s66")}
              >
                <Mic className="h-4 w-4" />
              </Button>
            )}
            <textarea
              ref={inputRef}
              value={listening ? (input ? `${input} ${sttInterim}` : sttInterim) : input}
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
