import type { Metadata } from "next";
import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import { SwaggerUI } from "@/components/app/swagger-ui";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("page.docs.s1"), description: t("page.docs.s2") };
}

// /docs - interactive OpenAPI documentation (P7-1). Swagger UI renders the
// spec from /api/openapi.json; the "Authorize" button accepts a kai_sk_ API
// key or a session JWT. Standalone page (outside the (app) AppShell group).
export default async function DocsPage() {
  const { t } = await serverT();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">KnowledgeAI</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {t("page.docs.s0")}
            </span>
          </div>
          <Link
            href="/developer"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("page.docs.s3")}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <SwaggerUI specUrl="/api/openapi.json" />
      </main>
    </div>
  );
}
