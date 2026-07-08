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
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/rag/types";

interface KbLite {
  id: string;
  name: string;
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
}

const suggestions = [
  "KnowledgeAI 的产品定位是什么？",
  "API 如何鉴权与限流？",
  "K8s 部署有哪些步骤？",
  "Agent 调研能输出什么格式？",
];

export default function ChatPage() {
  const [kbs, setKbs] = React.useState<KbLite[]>([]);
  const [selectedKb, setSelectedKb] = React.useState<string>("");
  const [conversations, setConversations] = React.useState<ConvLite[]>([]);
  const [activeConv, setActiveConv] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [highlightN, setHighlightN] = React.useState<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // load KBs
  React.useEffect(() => {
    fetch("/api/knowledge-base", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ kbs }) => {
        setKbs(kbs);
        if (kbs.length && !selectedKb) setSelectedKb(kbs[0].id);
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

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function refreshConversations() {
    if (!selectedKb) return;
    fetch(`/api/chat/conversations?kbId=${selectedKb}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ conversations }) => setConversations(conversations));
  }

  async function loadConversation(id: string) {
    setActiveConv(id);
    const res = await fetch(`/api/chat/conversations/${id}`, { cache: "no-store" });
    const { conversation } = await res.json();
    setMessages(
      conversation.messages.map((m: Msg) => ({ ...m, streaming: false }))
    );
  }

  function newChat() {
    setActiveConv(null);
    setMessages([]);
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || !selectedKb || sending) return;
    setInput("");
    setSending(true);

    const userMsg: Msg = { id: `u_${Date.now()}`, role: "user", content };
    const aiMsg: Msg = { id: `a_${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kbId: selectedKb, query: content, conversationId: activeConv ?? undefined }),
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
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
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") last.content = acc;
              return copy;
            });
          } else if (data.type === "done") {
            convId = data.conversationId;
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                last.content = acc;
                last.citations = data.citations;
                last.streaming = false;
              }
              return copy;
            });
          }
        }
      }
      if (convId !== activeConv) {
        setActiveConv(convId);
        refreshConversations();
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          last.content = "生成失败，请重试。";
          last.streaming = false;
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  const activeCitations =
    [...messages].reverse().find((m) => m.role === "assistant" && m.citations && m.citations.length > 0)?.citations ?? [];
  const selectedKbObj = kbs.find((k) => k.id === selectedKb);

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
              placeholder="搜索会话"
              className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              暂无历史会话
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                activeConv === c.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1 flex-1 text-sm font-medium">{c.title}</span>
            </button>
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
                    {kb.name} · {kb.stats.ready} 篇就绪
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
            <EmptyState onPick={send} kbReady={!!selectedKbObj?.stats.ready} />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                onCite={(n) => setHighlightN(n)}
              />
            ))
          )}
        </div>

        {/* input */}
        <div className="border-t border-border p-3 sm:p-4">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={selectedKbObj ? "基于知识库提问…  (Enter 发送)" : "请先选择知识库"}
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
            <Button
              variant="gradient"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => send()}
              disabled={!input.trim() || sending || !selectedKb}
              aria-label="发送"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
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
    </div>
  );
}

function EmptyState({ onPick, kbReady }: { onPick: (q: string) => void; kbReady: boolean }) {
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

function MessageBubble({ msg, onCite }: { msg: Msg; onCite: (n: number) => void }) {
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
            <ActionBtn icon={RefreshCw} label="重新生成" />
            <ActionBtn icon={ThumbsUp} label="赞" />
            <ActionBtn icon={ThumbsDown} label="踩" />
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}
