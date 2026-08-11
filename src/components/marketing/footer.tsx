"use client";

import { useT } from "@/lib/i18n/provider";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { GithubIcon as Github, XIcon as Twitter, LinkedinIcon as Linkedin } from "@/components/icons/brand-icons";

function columns(t: (k: string) => string) {
  return [
  {
    title: t("page.footer.s0"),
    links: [
      { label: t("page.footer.s1"), href: "/#features" },
      { label: t("page.footer.s2"), href: "/#pricing" },
      { label: t("page.footer.s3"), href: "/#features" },
      { label: t("page.footer.s4"), href: "/#docs" },
    ],
  },
  {
    title: t("page.footer.s5"),
    links: [
      { label: t("page.footer.s6"), href: "/#docs" },
      { label: t("page.footer.s7"), href: "/#docs" },
      { label: t("page.footer.s8"), href: "/#docs" },
      { label: t("page.footer.s9"), href: "/#" },
    ],
  },
  {
    title: t("page.footer.s10"),
    links: [
      { label: t("page.footer.s11"), href: "/#" },
      { label: t("page.footer.s12"), href: "/#" },
      { label: t("page.footer.s13"), href: "/#" },
    ],
  },
  {
    title: t("page.footer.s14"),
    links: [
      { label: t("page.footer.s15"), href: "/privacy" },
      { label: t("page.footer.s16"), href: "/terms" },
      { label: t("page.footer.s17"), href: "/privacy" },
      { label: t("page.footer.s18"), href: "/privacy" },
    ],
  },
];
};

export function Footer() {
  const t = useT();
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

          {columns(t).map((col) => (
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
