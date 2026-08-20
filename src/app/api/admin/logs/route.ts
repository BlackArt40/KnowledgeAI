import { requireRoleJwt as requireRole } from "@/lib/auth/guard";
import { recentLogs } from "@/lib/obs/log";

export const dynamic = "force-dynamic";

// GET /api/admin/logs - recent structured log lines (P6-2).
// Query params: ?level=warn (filter by minimum level), ?requestId=<id>
// (correlate one request's lines), ?limit=<n> (default 200, max 500).
// Backed by the in-memory ring in src/lib/obs/log.ts (same process as the
// API server; Edge proxy lines land on stdout, not here).
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const level = url.searchParams.get("level") ?? undefined;
  const requestId = url.searchParams.get("requestId") ?? undefined;
  const raw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), 500) : 200;

  const logs = recentLogs({ level, requestId, limit });
  return Response.json({ logs, total: logs.length });
}
