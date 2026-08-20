// ---------------------------------------------------------------------------
// CSPRNG ID utilities (P0-6) - single source of truth for generated IDs.
//
// Previously every store had its own `uid()` built on Math.random() (seeded
// PRNG, predictable). Attackers could guess / collide conversation, doc, KB,
// task and - critically - API-key IDs. All IDs now come from the Web Crypto
// CSPRNG (crypto.getRandomValues / randomUUID), which is available in both
// Node and Edge runtimes, so these helpers are safe to import anywhere.
// ---------------------------------------------------------------------------

function randomHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** CSPRNG unique ID: `prefix_` + 12 hex chars (48 bits of entropy - stronger
 *  than the old Math.random().toString(36).slice(2,10) ≈ 41 bits). */
export function uid(prefix: string): string {
  return `${prefix}_${randomHex(6)}`;
}

/** CSPRNG API-key secret: `kai_sk_` + 32 random bytes base64url (256 bits).
 *  Unpredictable - a key created by one user cannot be guessed by another. */
export function genSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "kai_sk_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
