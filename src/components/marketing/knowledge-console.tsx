"use client";

import * as React from "react";
import {
  BarChart3,
  Bell,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Gauge,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Loader2,
  MessageSquareText,
  MessagesSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type Scene = "dashboard" | "kb" | "chat" | "agent";

// 与登录后 AppShell 相同的导航项（文案直接复用 app-shell 的键，保证一字不差）
const SCENES: { id: Scene; icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
  { id: "dashboard", icon: LayoutGrid, labelKey: "page.app-shell.s6" },
  { id: "kb", icon: BarChart3, labelKey: "page.app-shell.s7" },
  { id: "chat", icon: MessageSquareText, labelKey: "page.app-shell.s8" },
  { id: "agent", icon: Bot, labelKey: "page.app-shell.s9" },
];

// 仅作展示的导航项（营造与真实工作台一致的信息架构）
const INERT_ITEMS: { icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
  { icon: Users, labelKey: "page.app-shell.s11" },
  { icon: Gauge, labelKey: "page.app-shell.s13" },
  { icon: KeyRound, labelKey: "page.app-shell.s15" },
  { icon: Settings, labelKey: "page.app-shell.s16" },
];

interface SceneProps {
  /** 演示区已进入视口后才开始播放。 */
  active: boolean;
  /** 系统开启"减少动态效果"时直达终态。 */
  reduced: boolean;
}

/* ---------------------------------------------------------------- *
 * 实时演示：复刻登录后的工作台界面（侧边栏 + 顶栏 + 各页面）。
 * 每个场景是一段脚本化时间轴，进入视口后自动播放，右上角可「重新演示」。
 * ---------------------------------------------------------------- */

/** 元素进入视口后置 true（只置一次，动画只自动播放一次）。 */
function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/** 用户开启了系统级「减少动态效果」时跳过动画，直接渲染最终状态。 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** 毫秒级时间表调度；返回清理函数（卸载/重播时取消全部未触发的回调）。 */
function startTimeline(build: (later: (delayMs: number, fn: () => void) => void) => void) {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  build((delayMs, fn) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) fn();
      }, delayMs),
    );
  });
  return () => {
    cancelled = true;
    timers.forEach((timer) => clearTimeout(timer));
  };
}

export function KnowledgeConsole() {
  const t = useT();
  const [scene, setScene] = React.useState<Scene>("chat");
  // 递增后通过 key 重挂载场景组件，让动画从头播放
  const [runId, setRunId] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>();

  const activeLabelKey = SCENES.find((item) => item.id === scene)!.labelKey;

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/90 text-left shadow-2xl shadow-black/[0.06] backdrop-blur-xl"
    >
      {/* 窗口标题栏 */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          KnowledgeAI · {t("page.hero.s22")}
          <span aria-hidden className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
        </span>
        <button
          type="button"
          onClick={() => setRunId((value) => value + 1)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          {t("page.hero.s36")}
        </button>
      </div>

      <div className="flex">
        {/* 侧边栏（复刻登录后 AppShell） */}
        <aside className="hidden w-44 shrink-0 flex-col border-r border-border/70 bg-muted/20 p-3 sm:flex">
          <div className="flex items-center gap-2 px-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-gradient text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold">KnowledgeAI</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/70 bg-background px-2 py-1.5">
            <span className="h-4 w-4 shrink-0 rounded bg-brand-gradient" />
            <span className="flex-1 truncate text-[11px] font-medium">{t("page.hero.s47")}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </div>

          <div className="mt-3">
            <div className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">{t("page.app-shell.s5")}</div>
            <div className="space-y-0.5">
              {SCENES.map(({ id, icon: Icon, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={scene === id}
                  aria-label={t(labelKey)}
                  onClick={() => setScene(id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors",
                    scene === id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {t(labelKey)}
                  {id === "agent" && (
                    <span aria-hidden className="ml-auto rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold text-primary">
                      {t("page.app-shell.s26")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">{t("page.app-shell.s10")}</div>
            <div className="space-y-0.5">
              {INERT_ITEMS.slice(0, 2).map(({ icon: Icon, labelKey }) => (
                <div key={labelKey} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground/70">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {t(labelKey)}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">{t("page.app-shell.s14")}</div>
            <div className="space-y-0.5">
              {INERT_ITEMS.slice(2).map(({ icon: Icon, labelKey }) => (
                <div key={labelKey} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground/70">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {t(labelKey)}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 顶栏（复刻登录后 AppShell）：页面标题 + 搜索 + 通知 + 账号 */}
          <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
            <span className="text-sm font-semibold">{t(activeLabelKey)}</span>
            <div className="ml-auto flex items-center gap-2.5">
              <span className="hidden items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2 py-1 text-[11px] text-muted-foreground md:inline-flex">
                <Search className="h-3 w-3" />
                {t("page.app-shell.s2")}
                <span className="rounded border border-border/70 bg-muted/40 px-1 text-[9px]">⌘K</span>
              </span>
              <span className="relative inline-flex">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-semibold text-white">
                  {t("page.hero.s46").slice(0, 1)}
                </span>
                <span className="hidden text-[11px] font-medium sm:inline">{t("page.hero.s46")}</span>
                <ChevronDown className="hidden h-3 w-3 text-muted-foreground sm:inline" />
              </span>
            </div>
          </div>

          {/* 场景区 */}
          <div key={`${scene}-${runId}`} className="min-h-[310px] flex-1 p-4">
            {scene === "dashboard" && <DashboardScene active={inView} reduced={reduced} />}
            {scene === "kb" && <KbScene active={inView} reduced={reduced} />}
            {scene === "chat" && <ChatScene active={inView} reduced={reduced} />}
            {scene === "agent" && <AgentScene active={inView} reduced={reduced} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 仪表盘 ------------------------------ */

function DashboardScene({ active, reduced }: SceneProps) {
  const t = useT();
  // 0 → 1 的播放进度（数字滚动用）
  const [progress, setProgress] = React.useState(0);
  const [tasksShown, setTasksShown] = React.useState(0);
  const stats = [
    { label: t("page.dashboard.s8"), target: 128, chip: t("page.dashboard.s10") },
    { label: t("page.dashboard.s12"), target: -1, chip: "Pro" }, // -1 = ∞
    { label: t("page.dashboard.s14"), target: 41, chip: t("page.dashboard.s16") },
    { label: t("page.dashboard.s18"), target: 32, chip: t("page.dashboard.s20") },
  ];

  React.useEffect(() => {
    if (reduced) {
      return startTimeline((later) =>
        later(0, () => {
          setProgress(1);
          setTasksShown(2);
        }),
      );
    }
    if (!active) return;
    return startTimeline((later) => {
      for (let i = 1; i <= 8; i++) later(250 + i * 90, () => setProgress(i / 8));
      later(1250, () => setTasksShown(1));
      later(1550, () => setTasksShown(2));
    });
  }, [reduced, active]);

  return (
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t("page.dashboard.s29", { name: t("page.hero.s46") })} 👋</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{t("page.dashboard.s30")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background px-2 py-1 text-[11px] font-medium">
            <Plus className="h-3 w-3" />
            {t("page.dashboard.s27")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-[11px] font-medium text-white">
            <Sparkles className="h-3 w-3" />
            {t("page.dashboard.s28")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/70 bg-background px-3 py-2.5">
            <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {stat.chip}
            </span>
            <div className="mt-1.5 text-lg font-semibold tabular-nums">
              {stat.target < 0 ? "∞" : Math.round(stat.target * progress)}
            </div>
            <div className="text-[10px] text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border/70 bg-background p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <Bot className="h-3.5 w-3.5 text-primary" />
          {t("page.dashboard.s33")}
          <span className="ml-auto text-[10px] text-muted-foreground">{t("page.dashboard.s34")}</span>
        </div>
        <div className="mt-2 space-y-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className={cn(
                "flex items-center gap-2 rounded-lg bg-muted/25 px-2.5 py-2 transition-all duration-500",
                tasksShown > index ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
              )}
            >
              <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-[11px] font-medium">{t("page.agent.s35")}</span>
              <span className="ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <span className="block h-full w-full rounded-full bg-success" />
              </span>
              <span className="shrink-0 rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success">
                {t("page.dashboard.s22")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 知识库 ------------------------------ */

function KbScene({ active, reduced }: SceneProps) {
  const t = useT();
  const kbs = [t("page.hero.s42"), t("page.hero.s43"), t("page.hero.s44")];
  const [ready, setReady] = React.useState<boolean[]>([false, false, false]);
  const allReady = ready.every(Boolean);

  React.useEffect(() => {
    if (reduced) {
      return startTimeline((later) => later(0, () => setReady([true, true, true])));
    }
    if (!active) return;
    return startTimeline((later) => {
      for (let i = 0; i < 3; i++) {
        later(450 + i * 550, () => setReady((prev) => prev.map((done, j) => (j === i ? true : done))));
      }
    });
  }, [reduced, active]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t("page.kb.title")}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{t("page.kb.subtitle", { count: 41 })}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-[11px] font-medium text-white">
          <Plus className="h-3 w-3" />
          {t("page.dashboard.s27")}
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {kbs.map((name, index) => (
          <div
            key={name}
            className="rounded-xl border border-border/70 bg-gradient-to-br from-accent/50 via-card to-card p-3"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-semibold text-white">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <div className="mt-2 truncate text-xs font-semibold">{name}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{t("page.kb.noDesc")}</div>
            <div className="mt-2.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "flex items-center gap-1.5 transition-opacity duration-500",
                  ready[index] ? "visible opacity-100" : "invisible opacity-0",
                )}
              >
                <FileText className="h-3 w-3" />
                {t("page.kb.s2", { count: 1 })}
                <MessageSquareText className="h-3 w-3" />
                {t("page.kb.s3", { count: 128 })}
              </span>
              <span className="ml-auto shrink-0">
                {ready[index] ? (
                  <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success">
                    {t("page.kb.s5")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
                    <Loader2 className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
                    {t("page.kb.s4")}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        className={cn(
          "flex justify-center pt-0.5 transition-all duration-500",
          allReady ? "visible translate-y-0 opacity-100" : "invisible translate-y-1.5 opacity-0",
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] font-medium text-success">
          <Check className="h-3 w-3" />
          {t("page.hero.s24")} · {t("page.hero.s40")}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ 智能问答 ------------------------------ */

type ChatPhase = "idle" | "typing" | "sent" | "retrieving" | "streaming" | "done";

function ChatScene({ active, reduced }: SceneProps) {
  const t = useT();
  const question = t("page.hero.s17");
  const answer = t("page.hero.s18");
  const [inputText, setInputText] = React.useState("");
  const [phase, setPhase] = React.useState<ChatPhase>("idle");
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const done = phase === "done";
  const sources = [
    { title: t("page.hero.s5"), page: t("page.hero.s6") },
    { title: t("page.hero.s7"), page: t("page.hero.s8") },
  ];

  React.useEffect(() => {
    if (reduced) {
      return startTimeline((later) =>
        later(0, () => {
          setInputText("");
          setTypedAnswer(answer);
          setPhase("done");
        }),
      );
    }
    if (!active) return;
    return startTimeline((later) => {
      later(0, () => {
        setInputText("");
        setTypedAnswer("");
        setPhase("typing");
      });
      // 提问逐字输入
      const qStep = Math.max(14, Math.round(600 / question.length));
      for (let i = 1; i <= question.length; i++) {
        later(250 + i * qStep, () => setInputText(question.slice(0, i)));
      }
      const questionEnd = 250 + question.length * qStep;
      later(questionEnd + 350, () => {
        setInputText("");
        setPhase("sent");
      });
      later(questionEnd + 1000, () => setPhase("retrieving"));
      // 回答流式输出（每 26ms 吐 3 个字符）
      const streamStart = questionEnd + 1900;
      later(streamStart, () => setPhase("streaming"));
      const chunk = 3;
      const totalChunks = Math.ceil(answer.length / chunk);
      for (let c = 1; c <= totalChunks; c++) {
        later(streamStart + c * 26, () => setTypedAnswer(answer.slice(0, c * chunk)));
      }
      later(streamStart + (totalChunks + 1) * 26 + 80, () => setPhase("done"));
    });
  }, [reduced, active, question, answer]);

  return (
    <div className="flex h-full gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 知识库选择条 */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2 py-1 text-[11px] font-medium">
            <BookOpen className="h-3 w-3 text-primary" />
            {t("page.hero.s45")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            {t("page.chat.s71", { count: 3 })}
          </span>
        </div>

        {/* 消息区 */}
        <div className="mt-3 flex-1">
          {phase === "idle" || phase === "typing" ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="mt-2 text-xs font-semibold">{t("page.chat.s8")}</div>
              <div className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted-foreground">
                {t("page.chat.s33")}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="flex min-h-[32px] items-center rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
                  {question}
                </div>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                <div className="min-h-[36px] min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border/70 bg-background px-3 py-2 text-xs leading-relaxed">
                  {phase === "sent" || phase === "retrieving" ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                      {t("page.hero.s34")}
                    </span>
                  ) : (
                    <>
                      <span>
                        {typedAnswer}
                        {phase === "streaming" && <Caret />}
                      </span>
                      {done && (
                        <span className="ml-1.5 inline-flex gap-1 align-baseline">
                          <Cite n={1} />
                          <Cite n={2} />
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/25 px-2 py-0.5 text-[10px] text-muted-foreground">
            <Search className="h-2.5 w-2.5" />
            {t("page.chat.s74")}
          </span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2">
            <span className="flex-1 truncate text-[11px] text-muted-foreground">
              {phase === "typing" ? (
                <>
                  {inputText}
                  <Caret />
                </>
              ) : phase === "idle" ? (
                <span className="opacity-60">{t("page.chat.s55", { extra: "" })}</span>
              ) : (
                inputText || t("page.chat.s55", { extra: "" })
              )}
            </span>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
              <Send className="h-2.5 w-2.5" />
            </span>
          </div>
        </div>
      </div>

      {/* 引用来源面板（复刻真实问答页右侧栏） */}
      <div className="hidden w-52 shrink-0 flex-col rounded-xl border border-border/70 bg-muted/10 p-2.5 lg:flex">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <FileText className="h-3 w-3 text-primary" />
          {t("page.chat.s5")}
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {done ? 2 : 0}
          </span>
        </div>
        <div className="mt-2 flex-1">
          {done ? (
            <div className="space-y-2">
              {sources.map((source) => (
                <div key={source.title} className="rounded-lg border border-border/70 bg-background p-2">
                  <div className="truncate text-[10px] font-medium">{source.title}</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">{source.page}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="pt-6 text-center text-[10px] leading-relaxed text-muted-foreground">{t("page.chat.s80")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Agent 调研 ------------------------------ */

function AgentScene({ active, reduced }: SceneProps) {
  const t = useT();
  const topic = t("page.agent.s35");
  const steps = [
    t("page.agent.s40"),
    t("page.agent.s41"),
    t("page.agent.s42"),
    t("page.agent.s43"),
  ];
  // 0 待开始 / 1 进行中 / 2 已完成
  const [states, setStates] = React.useState<number[]>([0, 0, 0, 0]);
  const [reportReady, setReportReady] = React.useState(false);
  const running = states.some((state) => state === 1);

  React.useEffect(() => {
    if (reduced) {
      return startTimeline((later) =>
        later(0, () => {
          setStates([2, 2, 2, 2]);
          setReportReady(true);
        }),
      );
    }
    if (!active) return;
    return startTimeline((later) => {
      for (let i = 0; i < 4; i++) {
        later(400 + i * 600, () => setStates((prev) => prev.map((state, j) => (j === i ? 1 : state))));
        later(400 + i * 600 + 550, () => setStates((prev) => prev.map((state, j) => (j === i ? 2 : state))));
      }
      later(400 + 3 * 600 + 550 + 450, () => setReportReady(true));
    });
  }, [reduced, active]);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("page.agent.s62")}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{t("page.agent.s63")}</div>
      </div>

      {/* 主题输入 + 开始按钮（复刻真实 Agent 页） */}
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2">
        <span className="flex-1 truncate text-xs">{topic}</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
            running ? "bg-primary/15 text-primary" : "bg-brand-gradient text-white",
          )}
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-3 w-3" />}
          {running ? t("page.agent.s38") : t("page.agent.s39")}
        </span>
      </div>

      {/* 执行过程（步骤逐个推进） */}
      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary" />
          {t("page.agent.s65")}
        </div>
        <div className="mt-2 space-y-2">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center gap-2.5 rounded-lg bg-muted/25 px-2.5 py-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  states[index] === 2
                    ? "bg-success text-background"
                    : states[index] === 1
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background text-muted-foreground",
                )}
              >
                {states[index] === 2 ? (
                  <Check className="h-2.5 w-2.5" />
                ) : states[index] === 1 ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="text-[11px] font-medium">{step}</span>
              <span
                className={cn(
                  "ml-auto text-[10px]",
                  states[index] === 2 ? "font-medium text-success" : "text-muted-foreground",
                )}
              >
                {states[index] === 2 ? t("page.agent.s11") : states[index] === 1 ? t("page.agent.s68") : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 报告产出 */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 transition-all duration-500",
          reportReady ? "visible translate-y-0 opacity-100" : "invisible translate-y-1.5 opacity-0",
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-success" />
        <span className="text-xs font-medium text-success">{t("page.hero.s41")}</span>
      </div>
    </div>
  );
}

/* ------------------------------ 小组件 ------------------------------ */

/** 打字光标（流式输出时显示）。 */
function Caret({ light = false }: { light?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-0.5 inline-block h-3 w-[2px] animate-pulse align-middle motion-reduce:animate-none",
        light ? "bg-primary-foreground/80" : "bg-foreground/70",
      )}
    />
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary align-baseline">
      {n}
    </span>
  );
}
