import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/lib/openapi/spec";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/openapi.json - the OpenAPI 3.0.3 spec for the v1 public API
// (P7-1). Public (no auth) - it describes a public surface; the /docs page
// fetches it. In proxy SKIP_PATHS so docs browsing is never rate-limited.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/openapi.json", async () =>
    NextResponse.json(OPENAPI_SPEC, {
      headers: { "Cache-Control": "no-store" },
    })
  );
}
