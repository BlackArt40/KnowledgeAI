import { describe, expect, it } from "vitest";
import {
  activityToCsv,
  categorizeAction,
  mergeActivity,
  securityAuditToActivity,
  teamAuditToActivity,
} from "./activity";
import type { AuditEntry } from "./types";
import type { AuditEvent } from "@/lib/security/audit";

function teamEntry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "m_1",
    actor: "张明",
    action: "修改角色",
    target: "李芳",
    detail: "角色由 editor 调整为 admin",
    createdAt: 1_000,
    ...over,
  };
}

function securityEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "aud_1",
    actorId: "usr_1",
    actor: "张明",
    action: "sharelink.create",
    target: "产品文档",
    detail: "创建知识库分享链接",
    ip: null,
    prevHash: "h0",
    hash: "h1",
    createdAt: 2_000,
    ...over,
  };
}

describe("categorizeAction", () => {
  it("maps known team and security actions", () => {
    expect(categorizeAction("team", "邀请成员")).toBe("member");
    expect(categorizeAction("team", "修改角色")).toBe("permission");
    expect(categorizeAction("team", "上传文档")).toBe("content");
    expect(categorizeAction("security", "kb.access_change")).toBe("permission");
    expect(categorizeAction("security", "doc.access_change")).toBe("permission");
    expect(categorizeAction("security", "sharelink.create")).toBe("share");
    expect(categorizeAction("security", "doc.delete")).toBe("content");
  });

  it("falls back by prefix so new actions stay visible", () => {
    expect(categorizeAction("security", "sharelink.view")).toBe("share");
    expect(categorizeAction("security", "member.invite")).toBe("member");
    expect(categorizeAction("security", "auth.login_failed")).toBe("security");
    expect(categorizeAction("team", "未知动作")).toBe("team");
  });
});

describe("mergeActivity", () => {
  it("merges both sources newest-first and dedupes by id", () => {
    const page = mergeActivity(
      [teamEntry({ id: "dup", createdAt: 3_000 }), teamEntry()],
      [securityEvent({ id: "dup", createdAt: 3_000 }), securityEvent()],
      { limit: 10 }
    );
    expect(page.items.map((i) => i.id)).toEqual(["dup", "aud_1", "m_1"]);
    expect(page.total).toBe(3);
    expect(page.counts.permission).toBe(2);
    expect(page.counts.share).toBe(1);
    expect(page.counts.member).toBe(0);
  });

  it("filters by category without changing chip counts", () => {
    const page = mergeActivity([teamEntry()], [securityEvent()], {
      category: "permission",
    });
    expect(page.items.map((i) => i.id)).toEqual(["m_1"]);
    expect(page.total).toBe(1);
    expect(page.counts.share).toBe(1);
    expect(page.counts.permission).toBe(1);
  });

  it("searches actor/target/detail and paginates by before", () => {
    const rows = [
      teamEntry({ id: "a", actor: "张明", createdAt: 5_000 }),
      teamEntry({ id: "b", actor: "王浩", createdAt: 4_000 }),
      teamEntry({ id: "c", actor: "王浩", createdAt: 3_000 }),
    ];
    const first = mergeActivity(rows, [], { q: "王浩", limit: 1 });
    expect(first.items.map((i) => i.id)).toEqual(["b"]);
    expect(first.total).toBe(2);
    expect(first.nextCursor).toBe(4_000);

    const second = mergeActivity(rows, [], { q: "王浩", before: first.nextCursor, limit: 1 });
    expect(second.items.map((i) => i.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("keeps unmapped item shapes intact", () => {
    const item = securityAuditToActivity(securityEvent());
    expect(item).toMatchObject({
      source: "security",
      category: "share",
      action: "sharelink.create",
      actor: "张明",
      target: "产品文档",
    });
    expect(teamAuditToActivity(teamEntry()).source).toBe("team");
  });
});

describe("activityToCsv", () => {
  it("emits a BOM, header and escaped cells", () => {
    const csv = activityToCsv([
      {
        id: "x",
        source: "team",
        category: "permission",
        action: "修改角色",
        actor: '=HYPERLINK("x")',
        target: "产品文档",
        detail: "第一行\n第二行",
        createdAt: Date.UTC(2026, 10, 2, 12),
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"时间","类别","操作","操作者","对象","详情"');
    // Formula injection is neutralised with a leading apostrophe.
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"第一行\n第二行"');
    expect(csv).toContain("2026-11-02T12:00:00.000Z");
  });
});
