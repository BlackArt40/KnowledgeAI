import Link from "next/link";
import { Logo } from "@/components/logo";
import { GithubIcon as Github, XIcon as Twitter, LinkedinIcon as Linkedin } from "@/components/icons/brand-icons";

const columns = [
  {
    title: "产品",
    links: [
      { label: "功能特性", href: "/#features" },
      { label: "定价方案", href: "/#pricing" },
      { label: "Agent 调研", href: "/#features" },
      { label: "更新日志", href: "/#docs" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "使用教程", href: "/#docs" },
      { label: "API 文档", href: "/#docs" },
      { label: "博客", href: "/#docs" },
      { label: "状态页", href: "/#" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "/#" },
      { label: "联系我们", href: "/#" },
      { label: "招贤纳士", href: "/#" },
    ],
  },
  {
    title: "法律",
    links: [
      { label: "隐私政策", href: "/privacy" },
      { label: "服务条款", href: "/terms" },
      { label: "GDPR 声明", href: "/privacy" },
      { label: "Cookie 政策", href: "/privacy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              上传文档，AI 构建知识库，团队智能问答，自动生成调研报告。
              一站式企业级 AI 知识平台。
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[Github, Twitter, Linkedin].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="social"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-foreground">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} KnowledgeAI. 保留所有权利。
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-success" />
            所有系统运行正常 · 数据符合 GDPR 合规
          </p>
        </div>
      </div>
    </footer>
  );
}
