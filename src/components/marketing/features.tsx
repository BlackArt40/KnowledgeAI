import {
  Brain,
  FolderUp,
  Bot,
  Users,
  ShieldCheck,
  BarChart3,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="核心功能"
          title="一个平台，覆盖知识全生命周期"
          desc="从文档接入到智能问答，再到自动调研报告，KnowledgeAI 把散落的知识沉淀为团队的智能资产。"
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          {/* RAG Q&A — large */}
          <FeatureCard
            className="md:col-span-4"
            icon={Brain}
            title="智能问答（RAG）"
            desc="基于私有知识库的精准问答，回答附带可溯源的引用片段，点击即可跳转原文。流式输出，毫秒级响应。"
            tags={["引用溯源", "流式输出", "多轮对话"]}
          >
            <MiniChat />
          </FeatureCard>

          {/* Agent research — tall */}
          <FeatureCard
            className="md:col-span-2 md:row-span-2"
            icon={Bot}
            title="Agent 调研"
            desc="多个 Agent 协作规划、检索、分析、撰写，自动产出结构化调研报告。"
            tags={["LangGraph", "任务队列"]}
          >
            <MiniTimeline />
          </FeatureCard>

          {/* KB upload */}
          <FeatureCard
            className="md:col-span-2"
            icon={FolderUp}
            title="知识库管理"
            desc="拖拽上传 PDF / Word / Markdown / 网页，自动切片与向量化。"
            tags={["自动向量化"]}
          />

          {/* Team */}
          <FeatureCard
            className="md:col-span-2"
            icon={Users}
            title="团队协作"
            desc="RBAC 权限模型，共享知识库与操作审计，多租户数据隔离。"
            tags={["RBAC", "审计日志"]}
          />

          {/* row 3 */}
          <FeatureCard
            className="md:col-span-2"
            icon={BarChart3}
            title="用量监控"
            desc="问答、API、存储、Agent 任务用量一目了然，按天/周/月可视。"
            tags={["数据看板"]}
          />
          <FeatureCard
            className="md:col-span-2"
            icon={ShieldCheck}
            title="安全合规"
            desc="2FA、会话管理、数据导出，符合 GDPR 与个人信息保护法。"
            tags={["GDPR"]}
          />
          <FeatureCard
            className="md:col-span-2"
            icon={ArrowUpRight}
            title="订阅计费"
            desc="免费 / 专业 / 企业三档套餐，支持微信、支付宝与信用卡。"
            tags={["Stripe"]}
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  tags,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  tags?: string[];
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${className ?? ""}`}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {desc}
      </p>
      {tags && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
      {children && <div className="mt-5 flex-1">{children}</div>}
    </div>
  );
}

function MiniChat() {
  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex justify-end">
        <span className="rounded-xl rounded-br-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          本季度核心指标？
        </span>
      </div>
      <div className="flex gap-2">
        <span className="mt-0.5 h-6 w-6 rounded-md bg-brand-gradient" />
        <span className="rounded-xl rounded-tl-sm bg-background px-3 py-1.5 text-xs">
          营收同比增长 38%，RAG 调用量翻倍
          <sup className="ml-1 text-primary">[1]</sup>
        </span>
      </div>
    </div>
  );
}

function MiniTimeline() {
  const steps = [
    { label: "Plan", done: true },
    { label: "Search", done: true },
    { label: "Analyze", done: false },
    { label: "Write", done: false },
  ];
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${
              s.done
                ? "bg-brand-gradient text-white"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            {i + 1}
          </span>
          <span className="text-sm font-medium">{s.label}</span>
          {s.done && (
            <span className="ml-auto text-[11px] text-success">已完成</span>
          )}
          {!s.done && i === 2 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary" />
              进行中
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Badge variant="default" className="mb-4">
        {eyebrow}
      </Badge>
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {desc && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
          {desc}
        </p>
      )}
    </div>
  );
}
