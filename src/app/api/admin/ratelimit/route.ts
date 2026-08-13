import { requireRole } from "@/lib/auth/guard";
import {
  getRateLimitLimits,
  isDistributedRateLimit,
  rateLimitStats,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// GET /api/admin/ratelimit - rate-limit dashboard data (P3-3)
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const { live, recent } = rateLimitStats();
  return Response.json({
    mode: isDistributedRateLimit() ? "redis" : "memory",
    limits: getRateLimitLimits(),
    live,
    recent,
  });
}
