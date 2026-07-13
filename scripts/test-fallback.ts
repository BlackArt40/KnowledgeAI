// @ts-nocheck
// Verify in-memory fallback works when DATABASE_URL is NOT set.
async function main() {
  const { createUser, listUsers } = await import("../src/lib/auth/store");
  const { isDbEnabled } = await import("../src/lib/db/client");
  const { createKb, listAllKbs } = await import("../src/lib/kb/store");
  const { updateConfig, getConfig } = await import("../src/lib/admin/store");

  console.log("isDbEnabled (no DATABASE_URL):", isDbEnabled());
  const u = createUser("fallback", "fallback@x.dev", "pw", "editor") as any;
  const kb = createKb({ name: "fallbackKB", desc: "mem" }, u.id);
  updateConfig({ rateLimitPerMin: 999 });
  console.log("createUser ok:", !!u.id && !u.error);
  console.log("createKb ok:", !!kb.id);
  console.log("listUsers count:", listUsers().length);
  console.log("listAllKbs has fallback KB:", listAllKbs().some((k: any) => k.name === "fallbackKB"));
  console.log("config updated:", getConfig().rateLimitPerMin === 999);
  console.log("FALLBACK OK");
}
main();
