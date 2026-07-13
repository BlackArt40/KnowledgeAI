// @ts-nocheck

// ---------------------------------------------------------------------------
// Prisma Seed Script - migrates demo data to PostgreSQL.
//
// Usage:
//   pnpm add @prisma/client
//   npx prisma generate
//   npx prisma migrate deploy
//   npx prisma db seed
//
// Or run directly:
//   npx tsx prisma/seed.ts
//
// Creates: 4 demo users, 5 knowledge bases, sample documents,
// subscriptions, and a team - matching the in-memory demo data.
// ---------------------------------------------------------------------------

import crypto from "crypto";

function hashPwd(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

const DEMO_PASSWORD = "password123";

const SEED_USERS = [
  { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "OWNER", status: "ACTIVE", plan: "enterprise" },
  { id: "usr_admin", email: "admin@knowledgeai.dev", name: "李芳（Admin）", role: "ADMIN", status: "ACTIVE", plan: "pro" },
  { id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "EDITOR", status: "ACTIVE", plan: "pro" },
  { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "VIEWER", status: "ACTIVE", plan: "free" },
];

const SEED_KBS = [
  { name: "产品文档", description: "产品需求、设计稿与迭代记录", color: "from-indigo-500/15", initial: "产" },
  { name: "API 文档", description: "OpenAPI 规范与接口说明", color: "from-emerald-500/15", initial: "A" },
  { name: "财务报告", description: "季度财报与预算明细", color: "from-amber-500/15", initial: "财" },
  { name: "运维手册", description: "部署、监控与故障排查", color: "from-sky-500/15", initial: "运" },
  { name: "更新日志", description: "版本发布与变更记录", color: "from-rose-500/15", initial: "更" },
];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  console.log("[seed] Starting database seeding...");

  // ── Users ──────────────────────────────────────────────────────────────
  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        passwordHash: hashPwd(DEMO_PASSWORD),
        role: u.role as never,
        status: u.status as never,
        lastLoginAt: null,
      },
    });
    console.log(`[seed] User: ${u.email}`);

    // Subscription
    const plan = u.plan === "enterprise" ? "enterprise" : u.plan === "pro" ? "pro" : "free";
    await prisma.subscription.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id,
        plan,
        status: "active",
        periodStart: new Date(Date.now() - 15 * 86400000),
        periodEnd: new Date(Date.now() + 15 * 86400000),
        cancelAtPeriodEnd: false,
      },
    });
  }

  // ── Team ───────────────────────────────────────────────────────────────
  const team = await prisma.team.upsert({
    where: { id: "team_default" },
    update: {},
    create: { id: "team_default", name: "KnowledgeAI 团队" },
  });
  console.log(`[seed] Team: ${team.name}`);

  for (const u of SEED_USERS) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: u.id } },
      update: {},
      create: {
        teamId: team.id,
        userId: u.id,
        role: u.role as never,
      },
    });
  }

  // ── Knowledge Bases ────────────────────────────────────────────────────
  const owner = SEED_USERS[0];
  for (const kbSeed of SEED_KBS) {
    const kbId = `kb_${kbSeed.name.slice(0, 4)}_${Math.random().toString(36).slice(2, 6)}`;
    const kb = await prisma.knowledgeBase.upsert({
      where: { id: kbId },
      update: {},
      create: {
        id: kbId,
        name: kbSeed.name,
        description: kbSeed.description,
        desc: kbSeed.description,
        color: kbSeed.color,
        initial: kbSeed.initial,
        ownerId: owner.id,
        teamId: team.id,
        settings: { chunkSize: 500, chunkOverlap: 50, embeddingModel: "text-embedding-3-small", topK: 5 },
      },
    });
    console.log(`[seed] KB: ${kb.name}`);

    // Sample document
    await prisma.kbDocument.create({
      data: {
        kbId: kb.id,
        name: `${kbSeed.name}_sample.md`,
        size: 45000,
        type: "markdown",
        status: "ready",
        progress: 100,
        chunks: 12,
        content: `# ${kbSeed.name}\n\n这是 ${kbSeed.name} 的示例文档内容。`,
      },
    }).catch(() => {});
  }

  // ── Notification Prefs (defaults) ──────────────────────────────────────
  for (const u of SEED_USERS) {
    await prisma.notificationPrefs.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id },
    });
  }

  console.log("[seed] ✅ Seeding complete!");
  console.log(`[seed] Users: ${SEED_USERS.length}, KBs: ${SEED_KBS.length}, Team: 1`);
  console.log(`[seed] Demo login: ${SEED_USERS[0].email} / ${DEMO_PASSWORD}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seed] ❌ Error:", err);
  process.exit(1);
});
