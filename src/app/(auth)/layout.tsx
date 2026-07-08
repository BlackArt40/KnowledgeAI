import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-card lg:block">
        <div className="absolute inset-0 bg-brand-gradient" />
        <div className="absolute inset-0 bg-grid-dark opacity-40 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <Logo href="/" className="text-white [&_span:last-child]:text-white" />

          <div className="max-w-md">
            <h2 className="text-balance text-3xl font-bold leading-tight">
              把团队的每一份文档，
              <br />
              都变成可问答的智能资产。
            </h2>
            <p className="mt-4 text-white/80">
              RAG 智能问答、多 Agent 调研、企业级安全合规——一个平台搞定。
            </p>

            <figure className="mt-10 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
              <blockquote className="text-sm leading-relaxed text-white/90">
                “接入知识库后，新人 onboarding 时间缩短了一半，问答还带引用来源。”
              </blockquote>
              <figcaption className="mt-3 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
                  李
                </span>
                <span className="text-xs text-white/80">
                  李明轩 · Acme 技术负责人
                </span>
              </figcaption>
            </figure>
          </div>

          <p className="text-xs text-white/60">
            © {new Date().getFullYear()} KnowledgeAI · GDPR 合规
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-5 sm:p-6">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            ← 返回首页
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
