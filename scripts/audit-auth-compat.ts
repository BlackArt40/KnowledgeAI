// Read-only release preflight for the authentication/share compatibility fixes.
//
// Usage:
//   DATABASE_URL=postgresql://... npx tsx scripts/audit-auth-compat.ts
//
// This never changes database rows. It reports legacy AgentTask rows whose
// shareConfig is NULL, because the public report endpoint now default-denies
// those rows instead of treating them as public. Explicitly enabling only a
// reviewed set of known legacy links remains a separate, human-approved step.

import { getDb } from "../src/lib/db/client";

interface LegacyCounts {
  legacy_null: number;
  enabled_true: number;
  enabled_false: number;
  malformed: number;
}

interface LegacyTaskRow {
  id: string;
  userId: string;
  workspaceId: string | null;
  status: string;
  createdAt: Date;
}

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL is required; run this audit against a trusted staging/production read-only connection."
    );
  }

  const [counts] = await db.$queryRawUnsafe<LegacyCounts>(`
    SELECT
      COUNT(*) FILTER (WHERE "shareConfig" IS NULL)::int AS legacy_null,
      COUNT(*) FILTER (WHERE "shareConfig"->>'enabled' = 'true')::int AS enabled_true,
      COUNT(*) FILTER (WHERE "shareConfig"->>'enabled' = 'false')::int AS enabled_false,
      COUNT(*) FILTER (
        WHERE "shareConfig" IS NOT NULL
          AND (NOT ("shareConfig" ? 'enabled') OR "shareConfig"->>'enabled' NOT IN ('true', 'false'))
      )::int AS malformed
    FROM "AgentTask"
  `);

  const legacyRows = await db.$queryRawUnsafe<LegacyTaskRow>(`
    SELECT id, "userId", "workspaceId", status, "createdAt"
    FROM "AgentTask"
    WHERE "shareConfig" IS NULL
    ORDER BY "createdAt" DESC
    LIMIT 100
  `);

  console.log("[audit-auth-compat] AgentTask share state:");
  console.log(JSON.stringify(counts, null, 2));

  if (legacyRows.length > 0) {
    console.log(
      `\n[audit-auth-compat] ${counts.legacy_null} legacy task(s) have no shareConfig and will be default-denied after deployment.`
    );
    console.log("Review these IDs before deciding whether any known public links need an explicit migration:");
    for (const row of legacyRows) {
      console.log(
        `- ${row.id} | user=${row.userId} | workspace=${row.workspaceId ?? "ws_default"} | status=${row.status} | created=${row.createdAt.toISOString()}`
      );
    }
    if (counts.legacy_null > legacyRows.length) {
      console.log(`- ... ${counts.legacy_null - legacyRows.length} more row(s) omitted`);
    }
  } else {
    console.log("\n[audit-auth-compat] No legacy NULL shareConfig rows found.");
  }

  console.log(
    "\n[audit-auth-compat] API-key calls are not persisted in a call-log table. Before deployment, audit structured/Loki logs for `dimension=apikey` on paths outside `/api/v1/*`; migrate any such clients to the versioned API instead of re-enabling legacy API-key access."
  );
}

main().catch((err) => {
  console.error(`[audit-auth-compat] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
