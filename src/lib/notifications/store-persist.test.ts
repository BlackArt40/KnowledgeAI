// P1 regression: notifications/prefs were loaded from DB but never written
// back, and the demo seed replaced the hydrated inbox on first read.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/persist", () => ({
  persistNotification: vi.fn(async () => {}),
  persistNotificationPrefs: vi.fn(async () => {}),
  deleteNotificationFromDb: vi.fn(async () => {}),
}));

import {
  persistNotification,
  persistNotificationPrefs,
  deleteNotificationFromDb,
} from "@/lib/db/persist";
import {
  deleteNotification,
  listNotifications,
  markAllRead,
  markNotificationsHydrated,
  markRead,
  notify,
  updatePrefs,
  userChannel,
} from "./store";
import { subscribe } from "@/lib/realtime/bus";

const persist = vi.mocked(persistNotification);
const persistPrefs = vi.mocked(persistNotificationPrefs);
const deleteFromDb = vi.mocked(deleteNotificationFromDb);

beforeEach(() => {
  persist.mockClear();
  persistPrefs.mockClear();
  deleteFromDb.mockClear();
  (globalThis as unknown as Record<string, unknown>).__KAI_NOTIF_STORE__ = undefined;
});

describe("notification persistence (P1)", () => {
  it("writes notify / read / delete / preferences", () => {
    const n = notify("usr_1", "kbReady", "done", "body");
    expect(n).not.toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toMatchObject({ id: n!.id, userId: "usr_1" });

    markRead("usr_1", n!.id);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ id: n!.id, read: true }));

    markAllRead("usr_1");
    expect(persist.mock.calls.length).toBeGreaterThanOrEqual(3);

    expect(deleteNotification("usr_1", n!.id)).toBe(true);
    expect(deleteFromDb).toHaveBeenCalledWith(n!.id);

    updatePrefs("usr_1", { emailDigest: true });
    expect(persistPrefs).toHaveBeenCalledWith("usr_1", expect.objectContaining({ emailDigest: true }));
  });

  it("does not overwrite hydrated rows with demo notifications", () => {
    markNotificationsHydrated();
    // In DB mode a user with no rows must have an empty inbox, not 4 demos.
    expect(listNotifications("usr_no_rows")).toEqual([]);
  });

  it("broadcasts new notifications and unread changes", () => {
    const events: Array<Record<string, unknown>> = [];
    const off = subscribe(userChannel("usr_evt"), (e) => events.push(e as Record<string, unknown>));

    const n = notify("usr_evt", "teamActivity", "角色更新", "body");
    expect(events[0]).toMatchObject({
      type: "notification",
      notification: { id: n!.id, type: "teamActivity" },
    });

    markRead("usr_evt", n!.id);
    expect(events.at(-1)).toMatchObject({ type: "unread" });

    markAllRead("usr_evt");
    expect(events.at(-1)).toMatchObject({ type: "unread", unread: 0 });
    off();
  });
});
