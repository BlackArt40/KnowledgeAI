import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  FileText,
  Brain,
  Search,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* background layers */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid dark:bg-grid-dark [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-10%] -z-10 h-[520px] w-[820px] -translate-x-1/2 aurora animate-aurora opacity-70 dark:opacity-50" />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <Link
            href="/#docs"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            全新 Agent 调研已上线
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>

          <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            把文档变成团队的
            <br className="hidden sm:block" />
            <span className="text-gradient">第二大脑</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            上传文档，AI 自动构建知识库；团队基于知识库智能问答，
            并由多 Agent 协作自动生成调研报告。
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="gradient" size="lg" asChild>
              <Link href="/register">
                免费开始
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/#features">查看演示</Link>
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {["无需信用卡", "每月 100 次免费问答", "支持私有部署"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-success" />
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* product preview */}
        <div className="relative mx-auto mt-16 max-w-4xl">
          <div className="absolute -inset-x-8 -top-6 bottom-0 -z-10 rounded-[2rem] bg-brand-gradient opacity-10 blur-2xl" />
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10 ring-1 ring-black/[0.02]">
      {/* window bar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-destructive/60" />
        <span className="h-3 w-3 rounded-full bg-warning/70" />
        <span className="h-3 w-3 rounded-full bg-success/70" />
        <span className="ml-3 text-xs font-medium text-muted-foreground">
          KnowledgeAI · 智能问答
        </span>
        <Badge variant="default" className="ml-auto">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          产品文档知识库
        </Badge>
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_220px]">
        {/* chat */}
        <div className="space-y-4 p-5">
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              2026 年 AI 工程师的就业趋势如何？
            </div>
          </div>
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
              <Brain className="h-4 w-4" />
            </span>
            <div className="max-w-[85%] space-y-2">
              <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm leading-relaxed">
                根据知识库文档，2026 年 AI 工程师需求持续增长，
                RAG、Agent 与 MLOps 方向尤为紧缺。
                <span className="mt-2 inline-flex flex-wrap gap-1.5">
                  <Cite n={1} />
                  <Cite n={2} />
                </span>
              </div>
              <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
                <button className="inline-flex items-center gap-1 hover:text-foreground">
                  <FileText className="h-3 w-3" /> 复制
                </button>
                <button className="inline-flex items-center gap-1 hover:text-foreground">
                  重新生成
                </button>
              </div>
            </div>
          </div>

          {/* input */}
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background p-2 pl-4">
            <span className="flex-1 text-sm text-muted-foreground">
              基于知识库提问…
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </div>

        {/* sources panel */}
        <div className="hidden flex-col gap-3 border-l border-border bg-muted/30 p-4 md:flex">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Search className="h-3.5 w-3.5 text-primary" /> 引用来源
          </div>
          {[
            { t: "2026 AI 人才报告", p: "第 12 页" },
            { t: "行业招聘趋势白皮书", p: "第 3 页" },
            { t: "技术岗位薪酬调研", p: "第 8 页" },
          ].map((s) => (
            <div
              key={s.t}
              className="rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="line-clamp-1 text-xs font-medium">
                  {s.t}
                </span>
              </div>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {s.p}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary align-baseline">
      {n}
    </span>
  );
}
