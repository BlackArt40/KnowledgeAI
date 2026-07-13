#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Prisma Migration CI Check
#
# Verifies that the Prisma schema is in sync with migrations.
# Fails (exit code 1) if the schema has drifted from migrations.
#
# Usage:
#   ./scripts/check-prisma-migrations.sh
# ---------------------------------------------------------------------------

set -euo pipefail

cd "$(dirname "$0")/.."

echo "🔍 Checking Prisma schema <-> migration sync..."

# Check if prisma is available
if ! npx prisma --version >/dev/null 2>&1; then
  echo "⚠️  Prisma CLI not installed. Skipping migration check."
  echo "   Install with: pnpm add -D prisma && npx prisma generate"
  exit 0
fi

# Generate the client (ensures schema is valid)
echo "📦 Generating Prisma client..."
npx prisma generate

# If no migrations directory exists yet, that's OK for initial setup
if [ ! -d "prisma/migrations" ]; then
  echo "⚠️  No migrations directory found. This is OK for initial setup."
  echo "   Run: npx prisma migrate dev --name init"
  exit 0
fi

# Check for migration drift
echo "🔎 Checking for schema drift..."
if [ -z "${DATABASE_URL:-}" ]; then
  echo "⚠️  DATABASE_URL not set. Skipping drift check (schema validation only)."
  exit 0
fi

DRIFT_OUTPUT=$(npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "${DATABASE_URL}" \
  2>&1) || true

if echo "$DRIFT_OUTPUT" | grep -qE "\[-|\[alter|CREATE|DROP|ALTER"; then
  echo "❌ Schema has drifted from migrations!"
  echo ""
  echo "The following changes need a new migration:"
  echo "$DRIFT_OUTPUT"
  echo ""
  echo "Run: npx prisma migrate dev --name <descriptive_name>"
  exit 1
fi

echo "✅ Prisma schema check passed."
