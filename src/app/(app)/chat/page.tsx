"use client";

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
  Loader2,
  MessageSquareText,
  Check,
  Trash2,
  Square,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
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
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/rag/types";

interface KbLite {
  id: string;
  name: string;
  shared?: boolean;
  ownerName?: string;
  stats: { total: number; ready: number };
}
interface ConvLite {
  id: string;
  title: string;
  updatedAt: number;
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  feedback?: "up" | "down";
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

const SUGGESTION_TEMPLATES = [
  (t: string) => `${t} 的主要内容是什么？`,
  (t: string) => `${t} 有哪些关键要点？`,
  (t: string) => `请帮我总结 ${t}`,
  (t: string) => `${t} 适合什么使用场景？`,
];

// derive-example-questions
// Build example questions from a KB's documents so the prompts stay relevant to
// the selected knowledge base instead of being hardcoded.
function kbSuggestions(
  docs: { name: string; type: string; url?: string; status: string }[],
  kbName: string
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
    out.push(SUGGESTION_TEMPLATES[i % SUGGESTION_TEMPLATES.length](topic));
    i++;
  }
  if (out.length === 0) out.push(`「${kbName}」知识库包含哪些内容？`);
  return out;
}

export default function ChatPage() {
  const [kbs, setKbs] = React.useState<KbLite[]>([]);
  const [selectedKb, setSelectedKb] = React.useState<string>("");
  const [conversations, setConversations] = React.useState<ConvLite[]>([]);
  const [convSearch, setConvSearch] = React.useState("");
  const [activeConv, setActiveConv] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [highlightN, setHighlightN] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
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
    setActiveConv(null);
    setMessages([]);
    fetch(`/api/chat/conversations?kbId=${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ conversations }) => setConversations(conversations));
  }, [selectedKb]);

  // Generate example questions from the selected KB's documents so the prompts
  // reflect the current knowledge base.
  React.useEffect(() => {
    if (!selectedKb) { setSuggestions([]); return; }
    fetch(`/api/knowledge-base/${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSuggestions(kbSuggestions(d.docs ?? [], d.kb?.name ?? "")))
      .catch(() => setSuggestions([]));
  }, [selectedKb]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
    fetch(`/api/chat/conversations?kbId=${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ conversations }) => setConversations(conversations));
  }

  async function loadConversation(id: string) {
    if (abortStream()) refreshConversations();
    setActiveConv(id);
    const res = await fetch(`/api/chat/conversations/${id}`, { cache: "no-store" });
    const { conversation } = await res.json();
    setMessages(
      conversation.messages.map((m: Msg) => ({ ...m, streaming: false }))
    );
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

  async function streamAnswer(content: string, aiMsgId: string, epoch: number) {
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kbId: selectedKb, query: content, conversationId: activeConv ?? undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

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
          if (data.type === "token") {
            acc += data.text;
            setMessages((m) =>
              m.map((x) => (x.id === aiMsgId ? { ...x, content: acc } : x))
            );
          } else if (data.type === "done") {
            convId = data.conversationId;
            setMessages((m) =>
              m.map((x) =>
                x.id === aiMsgId
                  ? { ...x, content: acc, citations: data.citations, streaming: false }
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
              ? { ...x, content: acc || "生成失败，请重试。", streaming: false }
              : x
          )
        );
      }
    } finally {
      abortRef.current = null;
    }
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
  // trailing assistant message, and stream a fresh answer.
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
      await streamAnswer(lastUser.content, aiId, epoch);
    } finally {
      if (epoch === sendEpoch.current) setSending(false);
    }
  }

  // Toggle like/dislike feedback on a message (client-side).
  const setFeedback = (id: string, v: "up" | "down") =>
    setMessages((m) =>
      m.map((x) =>
        x.id === id ? { ...x, feedback: x.feedback === v ? undefined : v } : x
      )
    );

  const activeCitations =
    [...messages].reverse().find((m) => m.role === "assistant" && m.citations && m.citations.length > 0)?.citations ?? [];
  const selectedKbObj = kbs.find((k) => k.id === selectedKb);
  const filteredConvs = conversations.filter((c) =>
    c.title.toLowerCase().includes(convSearch.trim().toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-0 overflow-hidden rounded-2xl border border-border bg-card lg:h-[calc(100vh-8.5rem)]">
      {/* sessions */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <div className="p-3">
          <Button variant="gradient" className="w-full justify-start" onClick={newChat}>
            <Plus className="h-4 w-4" /> 新建会话
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="搜索会话"
              className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {filteredConvs.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {convSearch ? "未找到匹配的会话" : "暂无历史会话"}
            </p>
          )}
          {filteredConvs.map((c) => (
            <div
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                activeConv === c.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1 flex-1 text-sm font-medium">{c.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(c.id);
                }}
                className={cn(
                  "shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive",
                  activeConv === c.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                aria-label="删除会话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* header / kb selector */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          {kbs.length === 0 ? (
            <span className="text-sm text-muted-foreground">暂无知识库</span>
          ) : (
            <Select value={selectedKb} onValueChange={setSelectedKb}>
              <SelectTrigger className="h-9 w-[220px] gap-2">
                <Library className="h-4 w-4 text-primary" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kbs.map((kb) => (
                  <SelectItem key={kb.id} value={kb.id}>
                    {kb.name} · {kb.stats.ready} 篇就绪{kb.shared ? ` · ${kb.ownerName} 共享` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedKbObj && (
            <Badge variant="success" className="ml-auto">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {selectedKbObj.stats.ready} 篇可检索
            </Badge>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <EmptyState onPick={send} kbReady={!!selectedKbObj?.stats.ready} suggestions={suggestions} />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                onCite={(n) => setHighlightN(n)}
                onRegenerate={regenerate}
                onFeedback={(v) => setFeedback(m.id, v)}
              />
            ))
          )}
        </div>

        {/* input */}
        <div className="border-t border-border p-3 sm:p-4">
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
              placeholder={selectedKbObj ? "基于知识库提问…  (Enter 发送)" : "请先选择知识库"}
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
            {sending ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={stopGeneration}
                aria-label="停止生成"
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
                aria-label="发送"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* sources */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-muted/30 xl:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">引用来源</span>
          <Badge variant="secondary" className="ml-auto">
            {activeCitations.length}
          </Badge>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {activeCitations.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              AI 回答的引用来源将显示在此处
            </p>
          ) : (
            activeCitations.map((c) => (
              <div
                key={c.n}
                className={cn(
                  "rounded-xl border bg-card p-3 transition-colors",
                  highlightN === c.n ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-[11px] font-semibold text-primary">
                    {c.n}
                  </span>
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="line-clamp-1 text-xs font-medium">{c.docName}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                  {c.snippet}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">片段 #{c.chunkIndex + 1}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    相似度 {(c.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* delete conversation confirmation */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
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
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-lg shadow-primary/30">
        <Sparkles className="h-7 w-7" />
      </span>
      <h3 className="mt-5 text-lg font-semibold">基于知识库智能问答</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {kbReady
          ? "输入问题，AI 将从知识库检索相关文档并生成带引用的回答。"
          : "当前知识库还没有就绪的文档，先去上传一些文档吧。"}
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
          <Link href="/knowledge-base">前往知识库上传文档</Link>
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
  onFeedback?: (v: "up" | "down") => void;
}) {
  const [copied, setCopied] = React.useState(false);
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
          <RichText text={msg.content} onCite={onCite} />
          {msg.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
          )}
        </div>
        {!msg.streaming && msg.content && (
          <div className="mt-1.5 flex items-center gap-1 px-1">
            <ActionBtn
              icon={copied ? Check : Copy}
              label={copied ? "已复制" : "复制"}
              onClick={() => {
                navigator.clipboard?.writeText(msg.content.replace(/\[\d+\]/g, ""));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            <ActionBtn icon={RefreshCw} label="重新生成" onClick={onRegenerate} />
            <ActionBtn icon={ThumbsUp} label="赞" active={msg.feedback === "up"} onClick={() => onFeedback?.("up")} />
            <ActionBtn icon={ThumbsDown} label="踩" active={msg.feedback === "down"} onClick={() => onFeedback?.("down")} />
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
