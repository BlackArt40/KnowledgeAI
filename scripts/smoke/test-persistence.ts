// @ts-nocheck
// End-to-end persistence test for P0-1.
//   mode "write"  : perform store mutations, then verify they landed in Postgres.
//   mode "verify" : fresh process -> init stores -> hydrate from DB -> verify data survived.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/test-persistence.ts write
//   DATABASE_URL=... npx tsx scripts/test-persistence.ts verify
import { PrismaClient } from "@prisma/client";

const DB_URL = "postgresql://postgres:postgres@localhost:5433/kai?schema=public";
process.env.DATABASE_URL = DB_URL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEST_EMAIL = "test_persist@knowledgeai.dev";
const TEST_KB = "持久化测试KB";
const TEST_DOC = "持久化权限文档";

async function writeMode() {
  const { createUser, listUsers } = await import("../../src/lib/auth/store");
  const { addDocument, createKb, listAllKbs, setDocumentAccess } = await import("../../src/lib/kb/store");
  const { inviteMember, updateTeam } = await import("../../src/lib/team/store");
  const { updateConfig } = await import("../../src/lib/admin/store");

  console.log("[write] performing mutations...");
  const u = createUser("测试用户", TEST_EMAIL, "password123", "editor") as any;
  if (u?.error) throw new Error("createUser failed: " + u.error);
  const userId = u.id;
  await sleep(400); // let persistUser flush before team invite resolves userId

  const kb = createKb({ name: TEST_KB, desc: "e2e persistence" }, userId);
  const kbId = kb.id;

  // P4-2 文档级权限必须落库：此前 access 只在内存，重启后静默回退为继承。
  const doc = addDocument({ kbId, name: TEST_DOC, size: 12, skipEnqueue: true });
  setDocumentAccess(doc.id, "private");

  const m = inviteMember({ name: "测试", email: TEST_EMAIL, role: "editor" }, "测试者");
  updateTeam({ plan: "企业版" });
  updateConfig({ rateLimitPerMin: 123, maintenanceMode: true });

  await sleep(1200); // let all fire-and-forget persists flush

  // Direct DB verification
  const prisma = new PrismaClient();
  const dbUser = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  const dbKb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
  const dbMember = await prisma.teamMember.findFirst({
    where: { teamId: "team_default", user: { email: TEST_EMAIL } },
    include: { user: true },
  });
  const dbAudit = await prisma.auditLog.findFirst({
    where: { teamId: "team_default", target: "测试" },
  });
  const dbTeam = await prisma.team.findUnique({ where: { id: "team_default" } });
  const dbCfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
  const dbDoc = await prisma.kbDocument.findUnique({ where: { id: doc.id } });
  await prisma.$disconnect();

  const checks: [string, boolean][] = [
    ["user in DB", !!dbUser],
    ["kb in DB", !!dbKb && dbKb.name === TEST_KB],
    ["document access in DB", dbDoc?.access === "private"],
    ["team member in DB", !!dbMember && dbMember.user.email === TEST_EMAIL],
    ["audit entry in DB", !!dbAudit && dbAudit.actor === "测试者"],
    ["team.plan persisted", !!dbTeam && dbTeam.plan === "企业版"],
    ["systemConfig persisted", !!dbCfg && dbCfg.rateLimitPerMin === 123 && dbCfg.maintenanceMode === true],
  ];

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "[write] PASS" : "[write] FAIL");
  process.exit(ok ? 0 : 1);
}

async function verifyMode() {
  const { listUsers } = await import("../../src/lib/auth/store");
  const { listAllKbs } = await import("../../src/lib/kb/store");
  const { getTeam, listMembers, listAudit } = await import("../../src/lib/team/store");
  const { getConfig } = await import("../../src/lib/admin/store");
  const { hydrateFromDb } = await import("../../src/lib/db/hydrate");

  // Touch each store to initialize globals (seeds demo data in memory).
  listUsers(); listAllKbs(); getTeam(); listMembers(); listAudit(); getConfig();

  console.log("[verify] hydrating from DB (simulating restart)...");
  await hydrateFromDb();
  await sleep(300);

  const users = listUsers();
  const kbs = listAllKbs();
  const members = listMembers();
  const audit = listAudit();
  const cfg = getConfig();
  const { getDocument } = await import("../../src/lib/kb/store");
  const prisma = new PrismaClient();
  const dbDoc = await prisma.kbDocument.findFirst({ where: { name: TEST_DOC } });
  await prisma.$disconnect();

  const checks: [string, boolean][] = [
    ["test user hydrated", users.some((u: any) => u.email === TEST_EMAIL)],
    ["test KB hydrated", kbs.some((k: any) => k.name === TEST_KB)],
    ["document access hydrated", !!dbDoc && getDocument(dbDoc.id)?.access === "private"],
    ["test member hydrated", members.some((m: any) => m.email === TEST_EMAIL)],
    ["audit hydrated", audit.some((a: any) => a.target === "测试" && a.actor === "测试者")],
    ["team.plan hydrated", getTeam().plan === "企业版"],
    ["systemConfig hydrated", cfg.rateLimitPerMin === 123 && cfg.maintenanceMode === true],
  ];

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "[verify] PASS" : "[verify] FAIL");
  process.exit(ok ? 0 : 1);
}

const mode = process.argv[2] || "write";
if (mode === "verify") verifyMode();
else writeMode();
