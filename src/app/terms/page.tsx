import Link from "next/link";
import type { Metadata } from "next";
import { FileText, Scale, AlertCircle, BookOpen, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/logo";
import { serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("page.terms.s1") };
}

function sections(t: (k: string) => string) {
  return [
  {
    icon: BookOpen,
    title: t("page.terms.s4"),
    body: [
      t("page.terms.s5"),
      t("page.terms.s6"),
    ],
  },
  {
    icon: Scale,
    title: t("page.terms.s7"),
    body: [
      t("page.terms.s8"),
      t("page.terms.s9"),
    ],
  },
  {
    icon: AlertCircle,
    title: t("page.terms.s10"),
    body: [
      t("page.terms.s11"),
      t("page.terms.s12"),
      t("page.terms.s13"),
    ],
  },
  {
    icon: FileText,
    title: t("page.terms.s14"),
    body: [
      t("page.terms.s15"),
      t("page.terms.s16"),
    ],
  },
  {
    icon: ShieldAlert,
    title: t("page.terms.s17"),
    body: [
      t("page.terms.s18"),
      t("page.terms.s19"),
    ],
  },
];
};

export default async function TermsPage() {
  const { t } = await serverT();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t("page.terms.s0")}</Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t("page.terms.s1")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            最后更新：2026 年 7 月 8 日 · 使用 KnowledgeAI 即表示您同意以下条款。
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
          <p className="font-medium text-warning">{t("page.terms.s2")}</p>
          <p className="mt-1 text-muted-foreground">
            本服务包含 AI 自动生成内容。AI 生成内容可能不准确，请勿将其作为唯一决策依据。
          </p>
        </div>

        <div className="mt-10 space-y-10">
          {sections(t).map((s) => (
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
          <p className="font-medium">{t("page.terms.s3")}</p>
          <p className="mt-1 text-muted-foreground">
            本条款可能不时更新，更新后继续使用即视为同意。如有争议，双方应友好协商；协商不成的，提交服务提供方所在地有管辖权的人民法院诉讼解决。
          </p>
        </div>
      </article>
    </div>
  );
}
