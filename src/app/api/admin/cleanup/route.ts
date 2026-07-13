import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { listAllKbs } from "@/lib/kb/store";
import { getActiveUploadIds } from "@/lib/upload/store";
import { runCleanup } from "@/lib/storage/cleanup";

export const dynamic = "force-dynamic";

// POST /api/admin/cleanup
// Triggers a manual cleanup of orphaned temp files. Admin/Owner only.
export async function POST(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const activeKbIds = new Set(listAllKbs().map((kb) => kb.id));
  const activeUploadIds = getActiveUploadIds();

  const stats = await runCleanup(activeKbIds, activeUploadIds);

  return NextResponse.json({
    ...stats,
    freedMB: +(stats.freedBytes / 1024 / 1024).toFixed(2),
  });
}
