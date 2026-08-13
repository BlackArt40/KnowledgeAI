import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/health - liveness probe (P6-4).
// Answers 200 as long as the process is alive - dependency connectivity is
// NOT part of liveness (that is /api/health/ready). Used by Docker/K8s
// livenessProbe and the container HEALTHCHECK. Public + in proxy SKIP_PATHS
// so frequent probing is never rate-limited.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/health", async () =>
    Response.json({
      status: "ok",
      version: process.env.npm_package_version || "0.1.0",
      uptimeMs: Math.round(process.uptime() * 1000),
      ts: Date.now(),
    })
  );
}
