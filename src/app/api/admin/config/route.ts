import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/admin/store";
import { getProviderStatus, getEnabledCount } from "@/lib/config";
import { requireRole } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;
  return NextResponse.json({
    ...getConfig(),
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
  const { providers, providerSummary, ...configPatch } = body;
  return NextResponse.json({
    config: updateConfig(configPatch),
    providers: await getProviderStatus(),
    providerSummary: await getEnabledCount(),
  });
}
