import Link from "next/link";
import type { Metadata } from "next";
import { Shield, Database, Cookie, Eye, Trash2, FileText } from "lucide-react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "隐私政策" };

const SECTIONS = [
  {
    icon: Database,
    title: "一、数据收集范围",
    body: [
      "我们仅收集为提供服务所必需的最少数据，包括：您上传的文档与知识库内容、问答与 Agent 调研记录、账户信息（姓名、邮箱）、用量统计与计费记录、设备与登录信息（IP、浏览器类型）。",
      "我们不会收集与服务无关的个人敏感信息，如身份证号、银行卡完整号等。支付信息由第三方支付网关（微信支付/支付宝）处理，我们不存储完整支付凭证。",
    ],
  },
  {
    icon: Eye,
    title: "二、数据使用方式",
    body: [
      "您的数据仅用于：提供知识库构建、智能问答与 Agent 调研服务；改进检索与生成质量；生成用量统计与账单；保障账户安全与反欺诈。",
      "除非您在设置中明确开启「数据用于模型训练」，否则我们不会将您的内容用于 AI 模型训练。即使开启，数据也会经过脱敏处理。",
    ],
  },
  {
    icon: Shield,
    title: "三、数据安全与隔离",
    body: [
      "所有数据传输均采用 TLS 1.3 加密。存储采用 AES-256 静态加密。多租户数据通过行级隔离（tenant_id）确保各团队数据互不可见。",
      "我们定期进行安全审计与渗透测试，并遵循最小权限原则管理内部数据访问。",
    ],
  },
  {
    icon: FileText,
    title: "四、用户权利（GDPR / 个人信息保护法）",
    body: [
      "根据 GDPR 第 15-22 条及《中华人民共和国个人信息保护法》，您享有以下权利：访问权（获取您的数据副本）、更正权（修改不准确的信息）、删除权（要求删除您的数据）、限制处理权、数据可携权、反对权。",
      "您可在「设置 → 数据隐私」中一键导出全部数据或申请删除账户。删除请求将在 30 天内完成处理。",
    ],
  },
  {
    icon: Cookie,
    title: "五、Cookie 政策",
    body: [
      "我们使用必要的 Cookie 以维持登录状态、保存主题偏好与语言设置。我们不使用第三方广告追踪 Cookie。",
      "您可随时在浏览器设置中清除 Cookie，但这可能影响部分功能体验。",
    ],
  },
  {
    icon: Trash2,
    title: "六、数据保留期限",
    body: [
      "账户活跃数据保留至账户删除；会话与调用日志默认保留 90 天，您可在设置中调整；删除账户后，所有数据将在 30 天内永久清除。",
    ],
  },
];

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold tracking-tight">隐私政策</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            最后更新：2026 年 7 月 8 日 · 本政策适用于 KnowledgeAI 提供的所有产品与服务。
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="font-medium text-primary">承诺摘要</p>
          <p className="mt-1 text-muted-foreground">
            我们尊重并依法保护您的个人隐私。数据最小化、端到端加密、多租户隔离是我们的核心原则。您对自己的数据拥有完全控制权。
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
          <p className="font-medium">联系我们</p>
          <p className="mt-1 text-muted-foreground">
            如您对本隐私政策有任何疑问，或需行使数据权利，请联系：
            <a href="mailto:privacy@knowledgeai.dev" className="text-primary hover:underline"> privacy@knowledgeai.dev</a>
          </p>
        </div>
      </article>
    </div>
  );
}
