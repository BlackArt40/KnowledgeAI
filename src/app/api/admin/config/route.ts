import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/admin/store";
import { getProviderStatus, getEnabledCount } from "@/lib/config";
import { requireRole } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;
  const cfg = getConfig();
  return NextResponse.json({
    ...cfg,
    // rateLimitPerMin is enforced by middleware (Edge runtime) which reads
    // from env, not from this in-memory config. Surface the actual env value.
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10),
    rateLimitEnvControlled: true,
    providers: await getProviderStatus(),
    providerSummary: await getEnabledCount(),
  });
}

export async function PATCH(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  // Don't allow overriding provider fields via PATCH
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { providers, providerSummary, ...configPatch } = body;
  const cfg = updateConfig(configPatch);
  recordAudit({
    actorId: guard.user.id,
    actor: guard.user.name,
    action: "admin.config_update",
    target: "系统配置",
    detail: `更新配置字段：${Object.keys(configPatch).join("、") || "（空）"}`,
  });
  return NextResponse.json({
    config: { ...cfg, rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10), rateLimitEnvControlled: true },
    providers: await getProviderStatus(),
    providerSummary: await getEnabledCount(),
  });
}
