import Link from "next/link";
import type { Metadata } from "next";
import { FileText, Scale, AlertCircle, BookOpen, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "服务条款" };

const SECTIONS = [
  {
    icon: BookOpen,
    title: "一、服务说明",
    body: [
      "KnowledgeAI（以下简称「本服务」）是一款基于 AI 的知识管理 SaaS 平台，提供文档上传、知识库构建、智能问答、Agent 调研报告等功能。注册并使用本服务即表示您同意本服务条款。",
      "本服务仅供合法用途使用。您须年满 18 周岁或达到所在司法管辖区的法定成年年龄方可使用。",
    ],
  },
  {
    icon: Scale,
    title: "二、使用规则",
    body: [
      "您承诺不会利用本服务从事以下行为：上传或传播违法、侵权或有害内容； attempt 未经授权访问系统或数据；滥用 API 接口或进行恶意攻击；以任何方式干扰服务的正常运行；未经许可对本服务进行逆向工程或二次开发转售。",
      "您对上传至本服务的内容享有完整权利，并保证其不侵犯第三方知识产权。我们对您上传的内容不主张所有权。",
    ],
  },
  {
    icon: AlertCircle,
    title: "三、AI 生成内容免责声明",
    body: [
      "本服务的智能问答与 Agent 调研功能基于检索增强生成（RAG）技术，其输出由 AI 模型根据您的知识库内容自动生成。",
      "AI 生成的内容可能存在不准确、不完整或过时的情况。我们不保证生成内容的准确性、完整性或适用性。您应在做出重要决策前自行核实生成内容，本服务仅供参考，不构成专业建议（法律、医疗、财务等）。",
      "对于因依赖 AI 生成内容而造成的任何直接或间接损失，我们不承担法律责任。",
    ],
  },
  {
    icon: FileText,
    title: "四、知识产权",
    body: [
      "本服务的软件、界面设计、品牌标识、源代码等知识产权归我们所有，受相关法律保护。未经书面许可，不得复制、修改或传播。",
      "您上传的文档与生成的内容归您所有。我们仅在提供服务所必需的范围内处理您的内容，不会将其转让给第三方。",
    ],
  },
  {
    icon: ShieldAlert,
    title: "五、服务变更与终止",
    body: [
      "我们保留随时修改、暂停或终止部分或全部服务的权利。套餐条款、定价与功能可能调整，调整前将提前通知。",
      "您可随时删除账户终止使用。若您违反本条款，我们有权限制或终止您的账户。",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">返回首页</Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">服务条款</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            最后更新：2026 年 7 月 8 日 · 使用 KnowledgeAI 即表示您同意以下条款。
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
          <p className="font-medium text-warning">重要提示</p>
          <p className="mt-1 text-muted-foreground">
            本服务包含 AI 自动生成内容。AI 生成内容可能不准确，请勿将其作为唯一决策依据。
          </p>
        </div>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <s.icon className="h-5 w-5 text-primary" />
                {s.title}
              </h2>
              <div className="mt-3 space-y-3">
                {s.body.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-border bg-muted/50 p-5 text-sm">
          <p className="font-medium">条款更新与争议解决</p>
          <p className="mt-1 text-muted-foreground">
            本条款可能不时更新，更新后继续使用即视为同意。如有争议，双方应友好协商；协商不成的，提交服务提供方所在地有管辖权的人民法院诉讼解决。
          </p>
        </div>
      </article>
    </div>
  );
}
