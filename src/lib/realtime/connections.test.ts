import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionRegistry, type ConnectionMember } from "./connections";

interface Member extends ConnectionMember {
  email?: string;
}

describe("createConnectionRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一成员多条连接按引用计数：最后一条关闭才下线", () => {
    const onChange = vi.fn();
    const registry = createConnectionRegistry<Member>("test-refcount", {
      ttlMs: 60_000,
      sweepMs: 60_000,
      onChange,
    });
    const member = { id: "u_ref", name: "张三", email: "z@example.com" };

    const first = registry.connect("group-a", member);
    const second = registry.connect("group-a", member);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(registry.list("group-a")).toHaveLength(1);

    first();
    expect(registry.list("group-a")).toHaveLength(1); // 另一个标签页还开着
    second();
    expect(registry.list("group-a")).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("断开句柄幂等，重复调用不会把别人的在线状态减掉", () => {
    const registry = createConnectionRegistry<Member>("test-idempotent", {
      ttlMs: 60_000,
      sweepMs: 60_000,
      onChange: () => {},
    });
    const leave = registry.connect("g", { id: "u_idem", name: "A" });
    leave();
    leave();
    expect(registry.list("g")).toHaveLength(0);
  });

  it("touch 续期后条目存活；超过 TTL 的入口被清理", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createConnectionRegistry<Member>("test-ttl", {
      ttlMs: 1_000,
      sweepMs: 100_000,
      onChange: () => {},
    });

    const leave = registry.connect("g", { id: "u_ttl", name: "B" });
    vi.setSystemTime(900);
    registry.touch("g", "u_ttl");
    vi.setSystemTime(1_500);
    expect(registry.list("g")).toHaveLength(1); // touch 后续期到 1900

    vi.setSystemTime(2_100);
    expect(registry.list("g")).toHaveLength(0);
    leave();
  });

  it("不同分组互不影响，列表按名称排序", () => {
    const registry = createConnectionRegistry<Member>("test-groups", {
      ttlMs: 60_000,
      sweepMs: 60_000,
      onChange: () => {},
    });
    registry.connect("kb:a", { id: "u2", name: "B" });
    registry.connect("kb:a", { id: "u1", name: "A" });
    registry.connect("kb:b", { id: "u3", name: "C" });

    expect(registry.list("kb:a").map((e) => e.member.id)).toEqual(["u1", "u2"]);
    expect(registry.list("kb:b").map((e) => e.member.id)).toEqual(["u3"]);
    expect(registry.list("missing")).toEqual([]);
  });
});
