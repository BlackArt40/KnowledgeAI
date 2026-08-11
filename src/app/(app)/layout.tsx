import { cookies } from "next/headers";
import { serverT } from "@/lib/i18n/server";
import { AppShell } from "@/components/app/app-shell";
import { getConfig } from "@/lib/admin/store";
import { verifyToken } from "@/lib/auth/session";
import { resolveWorkspace } from "@/lib/workspace/store";
import { getBrandCss, DEFAULT_BRAND_COLOR } from "@/lib/theme/brand-colors";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await serverT();
  const cookieStore = await cookies();
  const token = cookieStore.get("kai-token")?.value;

  // P5-5: resolve the active workspace's brand color and inject its CSS
  // variables server-side (no flash of the default indigo). Members stay
  // memory-only, so this covers the current tenant even in demo mode.
  const user = token ? await verifyToken(token) : null;
  const ws = user
    ? resolveWorkspace(user.id, user.email, cookieStore.get("kai-workspace")?.value)
    : undefined;
  const brandCss =
    ws && ws.brandColor && ws.brandColor !== DEFAULT_BRAND_COLOR
      ? getBrandCss(ws.brandColor)
      : "";

  // Maintenance mode: only owner/admin can bypass.
  const config = getConfig();
  if (config.maintenanceMode) {
    if (!user || (user.role !== "owner" && user.role !== "admin")) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-2xl text-white">
            🔧
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.layout.s0")}</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("page.layout.s1")}
          </p>
        </div>
      );
    }
  }

  return (
    <>
      {brandCss && (
        <style id="kai-brand-style" dangerouslySetInnerHTML={{ __html: brandCss }} />
      )}
      <AppShell>{children}</AppShell>
    </>
  );
}
