import { cookies } from "next/headers";
import { AppShell } from "@/components/app/app-shell";
import { getConfig } from "@/lib/admin/store";
import { verifyToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Maintenance mode: only owner/admin can bypass.
  const config = getConfig();
  if (config.maintenanceMode) {
    const token = (await cookies()).get("kai-token")?.value;
    const user = token ? await verifyToken(token) : null;
    if (!user || (user.role !== "owner" && user.role !== "admin")) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-2xl text-white">
            🔧
          </div>
          <h1 className="text-2xl font-bold tracking-tight">系统维护中</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            系统正在进行维护升级，请稍后再试。如有紧急问题，请联系管理员。
          </p>
        </div>
      );
    }
  }

  return <AppShell>{children}</AppShell>;
}
