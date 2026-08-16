import Link from "next/link";
import type { Metadata } from "next";
import { Shield, Database, Cookie, Eye, Trash2, FileText } from "lucide-react";
import { Logo } from "@/components/logo";
import { serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("page.privacy.s1") };
}

function sections(t: (k: string) => string) {
  return [
  {
    icon: Database,
    title: t("page.privacy.s4"),
    body: [
      t("page.privacy.s5"),
      t("page.privacy.s6"),
    ],
  },
  {
    icon: Eye,
    title: t("page.privacy.s7"),
    body: [
      t("page.privacy.s8"),
      t("page.privacy.s9"),
    ],
  },
  {
    icon: Shield,
    title: t("page.privacy.s10"),
    body: [
      t("page.privacy.s11"),
      t("page.privacy.s12"),
    ],
  },
  {
    icon: FileText,
    title: t("page.privacy.s13"),
    body: [
      t("page.privacy.s14"),
      t("page.privacy.s15"),
    ],
  },
  {
    icon: Cookie,
    title: t("page.privacy.s16"),
    body: [
      t("page.privacy.s17"),
      t("page.privacy.s18"),
    ],
  },
  {
    icon: Trash2,
    title: t("page.privacy.s19"),
    body: [
      t("page.privacy.s20"),
    ],
  },
];
};

export default async function PrivacyPage() {
  const { t } = await serverT();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t("page.privacy.s0")}</Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t("page.privacy.s1")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("page.privacy.s21")}
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="font-medium text-primary">{t("page.privacy.s2")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("page.privacy.s22")}
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
          <p className="font-medium">{t("page.privacy.s3")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("page.privacy.s23")}
            <a href="mailto:privacy@knowledgeai.dev" className="text-primary hover:underline"> privacy@knowledgeai.dev</a>
          </p>
        </div>
      </article>
    </div>
  );
}
