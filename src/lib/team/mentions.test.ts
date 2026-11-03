import { describe, expect, it } from "vitest";
import { extractMentionedMembers } from "./mentions";
import type { Member } from "./types";

const member = (id: string, name: string, email: string, status: Member["status"] = "active"): Member => ({
  id,
  name,
  email,
  role: "editor",
  status,
  lastActiveAt: 0,
  joinedAt: 0,
});

const MEMBERS = [
  member("m1", "王浩（Editor）", "editor@knowledgeai.dev"),
  member("m2", "赵琳（Viewer）", "viewer@knowledgeai.dev"),
  member("m3", "离职成员", "gone@knowledgeai.dev", "suspended"),
];

describe("extractMentionedMembers", () => {
  it("按姓名与邮箱匹配，返回去重的成员", () => {
    const found = extractMentionedMembers("@王浩（Editor） 和 @viewer@knowledgeai.dev 都看一下", MEMBERS);
    expect(found.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("同一成员多处提及只返回一次", () => {
    const found = extractMentionedMembers("@editor@knowledgeai.dev @王浩（Editor）", MEMBERS);
    expect(found).toHaveLength(1);
  });

  it("忽略未提及与已停用成员", () => {
    expect(extractMentionedMembers("普通评论", MEMBERS)).toEqual([]);
    expect(extractMentionedMembers("@离职成员 请看", MEMBERS)).toEqual([]);
  });
});
