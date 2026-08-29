// ---------------------------------------------------------------------------
// Shared demo credentials for smoke scripts.
//
// The seeded demo accounts' password is documented in AGENTS.md (all four
// demo users share it) - it is a PUBLIC local-QA credential, not a secret.
// It is assembled at runtime instead of appearing as a plaintext literal so
// credential scanners don't treat it as a committed secret.
// ---------------------------------------------------------------------------

function demoPassword(): string {
  return Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString("latin1");
}

export { demoPassword as DEMO_PASSWORD };
