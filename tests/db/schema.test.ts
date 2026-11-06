// Batch 3: SQL semantics that the mock-Prisma unit tests cannot prove —
// uniqueness, ON DELETE CASCADE, transaction rollback, and the write-through
// layer's actual row shape.
//
// Runs only against a real PostgreSQL (`DATABASE_URL`); CI's `quality` job
// provides one. Without it every case is skipped rather than failing, matching
// the smoke suite's SKIP convention.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { persistKb, persistUser } from "@/lib/db/persist";

const DB_URL = process.env.DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

process.env.DATABASE_URL = DB_URL ?? "";

const prisma = new PrismaClient();
const PREFIX = `dbtest_${Date.now().toString(36)}`;
const userIds: string[] = [];
const kbIds: string[] = [];

function userId(suffix: string): string {
  const id = `${PREFIX}_usr_${suffix}`;
  userIds.push(id);
  return id;
}

function kbId(suffix: string): string {
  const id = `${PREFIX}_kb_${suffix}`;
  kbIds.push(id);
  return id;
}

async function createUser(id: string, email = `${id}@example.test`) {
  return prisma.user.create({
    data: { id, email, name: "DB 测试用户", role: "EDITOR", status: "ACTIVE" },
  });
}

beforeAll(async () => {
  if (DB_URL) await prisma.$connect();
});

beforeEach(async () => {
  if (!DB_URL) return;
  // Table order respects FKs (documents before KBs, KBs before users).
  await prisma.kbDocument.deleteMany({ where: { kbId: { startsWith: PREFIX } } });
  await prisma.knowledgeBase.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
});

afterAll(async () => {
  if (!DB_URL) return;
  await prisma.kbDocument.deleteMany({ where: { kbId: { startsWith: PREFIX } } });
  await prisma.knowledgeBase.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

suite("real PostgreSQL semantics", () => {
  it("enforces the unique email constraint (P2002)", async () => {
    const first = userId("a");
    await createUser(first);
    await expect(createUser(userId("b"), `${first}@example.test`)).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("cascades document deletion from the knowledge base", async () => {
    const owner = userId("owner");
    await createUser(owner);
    const kb = kbId("cascade");
    await prisma.knowledgeBase.create({
      data: { id: kb, name: "级联测试", desc: "", ownerId: owner, workspaceId: "ws_default" },
    });
    await prisma.kbDocument.create({
      data: { id: `${PREFIX}_doc_1`, kbId: kb, name: "a.md", size: 3, type: "markdown", content: "abc" },
    });

    await prisma.knowledgeBase.delete({ where: { id: kb } });

    await expect(prisma.kbDocument.count({ where: { kbId: kb } })).resolves.toBe(0);
  });

  it("rolls back the whole transaction when a statement throws", async () => {
    const owner = userId("tx");
    await createUser(owner);
    const kb = kbId("tx");

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.knowledgeBase.create({
          data: { id: kb, name: "事务测试", desc: "", ownerId: owner, workspaceId: "ws_default" },
        });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(prisma.knowledgeBase.findUnique({ where: { id: kb } })).resolves.toBeNull();
  });

  it("writes the rows the in-memory stores expect (persist → read back)", async () => {
    const id = userId("persist");
    const now = Date.now();

    await persistUser({
      id,
      email: `${id}@example.test`,
      name: "持久化用户",
      passwordHash: null,
      role: "editor",
      status: "active",
      plan: "pro",
      createdAt: now,
      lastLoginAt: null,
    });

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row).toMatchObject({ email: `${id}@example.test`, name: "持久化用户", role: "EDITOR" });
    expect(row?.createdAt.getTime()).toBe(now);

    const kb = kbId("persist");
    await persistKb({
      id: kb,
      name: "持久化知识库",
      desc: "desc",
      ownerId: id,
      workspaceId: "ws_default",
      settings: { chunkSize: 200 },
      createdAt: now,
      updatedAt: now,
    });

    const kbRow = await prisma.knowledgeBase.findUnique({ where: { id: kb } });
    expect(kbRow).toMatchObject({ name: "持久化知识库", ownerId: id, workspaceId: "ws_default" });
    expect(kbRow?.settings).toEqual({ chunkSize: 200 });
  });
});
