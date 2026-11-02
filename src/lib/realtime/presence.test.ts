import { describe, expect, it } from "vitest";
import { subscribe } from "./bus";
import {
  connectPresence,
  getOnlineUsers,
  isOnline,
  PRESENCE_CHANNEL,
  touchPresence,
} from "./presence";

interface PresenceEvent {
  type: string;
  online: Array<{ userId: string; name: string }>;
}

describe("presence", () => {
  it("多标签页共享一个在线条目，关闭最后一条才离线，并全量广播", () => {
    const events: PresenceEvent[] = [];
    const unsubscribe = subscribe(PRESENCE_CHANNEL, (event) => {
      events.push(event as PresenceEvent);
    });

    const first = connectPresence("u_presence_tabs", "张三", "z@example.com");
    const second = connectPresence("u_presence_tabs", "张三", "z@example.com");
    expect(getOnlineUsers().filter((u) => u.userId === "u_presence_tabs")).toHaveLength(1);
    expect(isOnline("u_presence_tabs")).toBe(true);

    first();
    expect(isOnline("u_presence_tabs")).toBe(true); // 另一个标签页还开着

    second();
    expect(isOnline("u_presence_tabs")).toBe(false);
    expect(
      events.some((e) => e.online?.some((u) => u.userId === "u_presence_tabs"))
    ).toBe(true);
    expect(
      events.at(-1)?.online.some((u) => u.userId === "u_presence_tabs")
    ).toBe(false);

    unsubscribe();
  });

  it("touch 只续期，不重复登记用户", () => {
    const leave = connectPresence("u_presence_touch", "李四", "l@example.com");
    touchPresence("u_presence_touch");
    expect(getOnlineUsers().filter((u) => u.userId === "u_presence_touch")).toHaveLength(1);
    touchPresence("u_presence_missing"); // 未登记的 id 是 no-op
    leave();
  });
});
