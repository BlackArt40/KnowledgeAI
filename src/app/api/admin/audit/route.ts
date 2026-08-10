import { requireRole } from "@/lib/auth/guard";
import { listAudit, verifyAuditChain } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

// GET /api/admin/audit - security audit trail (P3-4)
// Query params: action (substring), actor (name/id substring),
//               from/to (epoch ms), limit (default 50, max 200)
// Returns { audit, total, chainValid } - chainValid reports whether the
// tamper-evident hash chain is intact.
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? undefined;
  const actor = url.searchParams.get("actor") ?? undefined;
  const from = url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined;
  const to = url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);

  const { audit, total } = listAudit({ action, actor, from, to, limit });
  return Response.json({ audit, total, chainValid: verifyAuditChain().valid });
}
