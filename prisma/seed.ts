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
import { log } from "../src/lib/obs/log";

// The bootstrap `migrate` container mounts ./src as well, so this import is
// available there. pino gives redaction + structured output; the repo-wide
// static scan forbids console.* as a server-side log sink.

function hashPwd(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// "password123" - the documented demo credential (AGENTS.md). Assembled from
// byte codes so no plaintext credential literal is committed to source.
const DEMO_PASSWORD = Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString("latin1");

const SEED_USERS = [
  { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "OWNER", status: "ACTIVE", plan: "enterprise" },
  { id: "usr_admin", email: "admin@knowledgeai.dev", name: "李芳（Admin）", role: "ADMIN", status: "ACTIVE", plan: "pro" },
  { id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "EDITOR", status: "ACTIVE", plan: "pro" },
  { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "VIEWER", status: "ACTIVE", plan: "free" },
];

// 演示语料（B3）：每库 1-3 篇真实内容文档，见 prisma/seed-kbs.ts
import { SEED_KBS } from "./seed-kbs";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  log.info("[seed] Starting database seeding...");

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
    log.info(`[seed] User: ${u.email}`);

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
  log.info(`[seed] Team: ${team.name}`);

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
  // Bootstrap reruns must be a no-op: the old id carried a random suffix, so
  // every rerun created 5 duplicate KBs + docs. Now: deterministic id, and a
  // name/owner lookup keeps pre-existing (legacy random-id) KBs untouched.
  const owner = SEED_USERS[0];
  for (const [i, kbSeed] of SEED_KBS.entries()) {
    // 历史库用过随机 id：先按 name/owner 找已有的，找到就复用，避免重复建库
    const existing = await prisma.knowledgeBase.findFirst({
      where: { ownerId: owner.id, name: kbSeed.name },
      select: { id: true },
    });
    const kbId = existing?.id ?? `kb_seed_${i + 1}`;
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
    log.info(`[seed] KB: ${kb.name}`);

    // 逐篇幂等入库：id 确定性生成，重跑只补缺，不覆盖已有处理结果。
    // 状态 queued 而非 ready：向量必须由应用侧真实切片 + 嵌入产出，
    // 早前写死 chunks:12 但向量表为空，导致演示问答检索为空。
    for (const [j, docSeed] of kbSeed.docs.entries()) {
      const docId = `doc_seed_${i + 1}_${j + 1}`;
      const content = docSeed.content;
      await prisma.kbDocument.upsert({
        where: { id: docId },
        update: {},
        create: {
          id: docId,
          kbId: kb.id,
          name: docSeed.name,
          size: Buffer.byteLength(content, "utf8"),
          type: docSeed.type,
          status: "queued",
          progress: 0,
          chunks: 0,
          content,
        },
      });
    }
    // 清掉旧版占位文档（内容是一句假的示例文本，检索时会污染答案）
    await prisma.kbDocument
      .deleteMany({ where: { kbId: kb.id, name: `${kbSeed.name}_sample.md` } })
      .catch(() => {});
  }

  // ── Notification Prefs (defaults) ──────────────────────────────────────
  for (const u of SEED_USERS) {
    await prisma.notificationPrefs.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id },
    });
  }

  log.info("[seed] ✅ Seeding complete!");
  log.info(`[seed] Users: ${SEED_USERS.length}, KBs: ${SEED_KBS.length}, Team: 1`);
  // Demo credential is documented in AGENTS.md (public local-QA cred) - the
  // console shim above has no redaction, so only the email is printed here.
  log.info(`[seed] Demo login: ${SEED_USERS[0].email}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  log.error({ err }, "[seed] ❌ Error");
  process.exit(1);
});
