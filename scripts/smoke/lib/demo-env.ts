// Env values the smoke scripts must inject into the throwaway production
// servers they spawn themselves.
//
// `next start` runs with NODE_ENV=production, where `src/lib/secrets.ts`
// refuses to boot without AUTH_SECRET (the demo fallback is dev/test only) -
// every route then answers 500. Scripts spread `...process.env`, so a machine
// or CI job without AUTH_SECRET (no `.env.local`) would leave their spawned
// instances dead. Supply a deterministic demo value instead: these are local
// throwaway servers holding in-memory demo data, never a real deployment.

export const SMOKE_AUTH_SECRET = "smoke-acceptance-demo-secret-not-for-production";

/** AUTH_SECRET for spawned production instances: the caller's value if set. */
export function demoAuthSecret(): string {
  return process.env.AUTH_SECRET || SMOKE_AUTH_SECRET;
}
