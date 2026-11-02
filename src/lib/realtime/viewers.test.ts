import { describe, expect, it } from "vitest";
import { subscribe } from "./bus";
import { getKbViewers, joinKbViewers, touchKbViewers } from "./viewers";

interface ViewersEvent {
  type: string;
  kbId: string;
  viewers: Array<{ userId: string; name: string }>;
}

describe("KB co-viewing", () => {
  it("加入/离开都广播全量共览列表，多标签页只算一人", () => {
    const kbId = "kb_viewers_test";
    const events: ViewersEvent[] = [];
    const unsubscribe = subscribe(`kb:${kbId}`, (event) => {
      events.push(event as ViewersEvent);
    });

    const leaveOwner = joinKbViewers(kbId, "u_view_owner", "张明");
    const leaveOwnerTab2 = joinKbViewers(kbId, "u_view_owner", "张明");
    const leaveEditor = joinKbViewers(kbId, "u_view_editor", "王浩");

    expect(
      getKbViewers(kbId).map((v) => v.userId).sort()
    ).toEqual(["u_view_editor", "u_view_owner"]);

    leaveOwner();
    expect(getKbViewers(kbId)).toHaveLength(2); // 第二个标签页仍在看

    leaveOwnerTab2();
    expect(getKbViewers(kbId).map((v) => v.userId)).toEqual(["u_view_editor"]);

    const last = events.at(-1);
    expect(last?.type).toBe("viewers");
    expect(last?.viewers.map((v) => v.userId)).toEqual(["u_view_editor"]);

    leaveEditor();
    expect(getKbViewers(kbId)).toEqual([]);
    unsubscribe();
  });

  it("touch 是 no-op 而非新增共览者", () => {
    const kbId = "kb_viewers_touch";
    touchKbViewers(kbId, "u_ghost");
    expect(getKbViewers(kbId)).toEqual([]);
  });
});
