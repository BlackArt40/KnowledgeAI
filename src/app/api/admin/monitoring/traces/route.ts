import { requireRoleJwt as requireRole } from "@/lib/auth/guard";
import { getTrace, listTraces } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/admin/monitoring/traces - full trace detail (?id=<traceId>) or a
// recent list. The span tree (api -> rag -> llm) reconstructs the full chain
// of a single request (P6-1 acceptance).
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const trace = getTrace(id);
    if (!trace) return Response.json({ error: "trace 不存在" }, { status: 404 });
    return Response.json({ trace });
  }
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 20), 1), 100);
  return Response.json({ traces: listTraces(limit) });
}
