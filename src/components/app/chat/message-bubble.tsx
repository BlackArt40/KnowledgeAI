"use client";

// P7: 消息气泡（用户 + 助手）与操作按钮，从 chat 页面抽出（原 1777 行单文件
// 膨胀修复）。行为与页面内联版本完全一致：复制/重新生成/朗读(TTS)/点赞点踩
// + 备注、流式光标、引用渲染。

import * as React from "react";
import { Brain, Check, Copy, RefreshCw, VolumeX, Volume2, ThumbsUp, ThumbsDown } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { ChatMarkdown } from "@/components/app/chat-markdown";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/rag/types";

/** 与 chat 页面 Msg 相同的消息形态（页面内联定义，避免循环引用）。 */
export interface BubbleMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  feedback?: "up" | "down";
  feedbackNote?: string;
  followUps?: string[];
}

export function MessageBubble({
  msg,
  onCite,
  onRegenerate,
  onFeedback,
}: {
  msg: BubbleMsg;
  onCite: (n: number) => void;
  onRegenerate?: () => void;
  onFeedback?: (v: "up" | "down", note?: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  // P7-4: read the answer aloud (TTS) - one speaker per bubble.
  const { supported: ttsSupported, speaking: ttsSpeaking, speak: ttsSpeak, cancel: ttsCancel } = useSpeechSynthesis();
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
            <ActionBtn
              icon={RefreshCw}
              label={t("page.chat.s37")}
              onClick={onRegenerate}
            />
            {/* P7-4: 朗读回答 (TTS) */}
            {ttsSupported && (
              <ActionBtn
                icon={ttsSpeaking ? VolumeX : Volume2}
                label={ttsSpeaking ? t("page.chat.s67") : t("page.chat.s68")}
                active={ttsSpeaking}
                onClick={() => {
                  if (ttsSpeaking) ttsCancel();
                  else ttsSpeak(msg.content.replace(/\[\d+\]/g, ""));
                }}
              />
            )}
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
                  {t("common.submit")}
                </button>
                <button
                  type="button"
                  onClick={() => { setNoteOpen(false); setNote(""); noteRef.current = ""; }}
                  className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
