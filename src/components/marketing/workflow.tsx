import { Upload, Database, MessageSquareText, FileBarChart } from "lucide-react";
import { SectionHeading } from "./features";

const steps = [
  {
    icon: Upload,
    title: "上传文档",
    desc: "拖拽 PDF / Word / Markdown / 网页链接，批量导入团队资料。",
  },
  {
    icon: Database,
    title: "AI 构建知识库",
    desc: "自动解析、切片、向量化，秒级完成知识库构建与索引。",
  },
  {
    icon: MessageSquareText,
    title: "团队智能问答",
    desc: "基于知识库精准问答，回答附带可溯源引用，支持多轮对话。",
  },
  {
    icon: FileBarChart,
    title: "生成调研报告",
    desc: "多 Agent 协作，自动产出结构化报告，一键导出 PDF / Markdown。",
  },
];

export function Workflow() {
  return (
    <section id="workflow" className="scroll-mt-20 border-y border-border bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="工作流"
          title="四步，把资料变成生产力"
          desc="从原始文档到可执行的调研报告，全流程自动化。"
        />

        <div className="relative mt-14">
          {/* connecting line */}
          <div className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4 md:gap-6">
            {steps.map((s, i) => (
              <div key={s.title} className="relative flex flex-col items-center text-center md:items-start md:text-left">
                <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
                  <s.icon className="h-6 w-6 text-primary" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
