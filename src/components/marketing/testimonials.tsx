import { Star } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SectionHeading } from "./features";

const reviews = [
  {
    quote:
      "把公司几千份技术文档接入知识库后，新人 onboarding 时间缩短了一半。问答带引用来源，可信度很高。",
    name: "李明轩",
    role: "技术负责人 · Acme",
    initials: "李",
  },
  {
    quote:
      "Agent 调研功能惊艳，输入一个课题就能产出结构化报告，团队周会准备效率提升巨大。",
    name: "陈思雨",
    role: "产品经理 · Globex",
    initials: "陈",
  },
  {
    quote:
      "多租户隔离和审计日志让我们安全团队很放心，私有部署选项也满足了合规要求。",
    name: "王浩然",
    role: "CTO · Initech",
    initials: "王",
  },
];

export function Testimonials() {
  return (
    <section className="border-y border-border bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="用户评价"
          title="团队信赖的知识伙伴"
          desc="来自不同行业团队的真实反馈。"
        />

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {reviews.map((r) => (
            <figure
              key={r.name}
              className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex gap-0.5 text-warning">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground">
                “{r.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <Avatar fallback={r.initials} />
                <div>
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
