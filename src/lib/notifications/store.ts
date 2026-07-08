// ---------------------------------------------------------------------------
// Notification Store - preferences + in-app notification inbox.
// 🔌 Production: replace with DB + email worker (Resend/SendGrid) + cron for
//    weekly digest.  In-app notifications -> push (Web Push / FCM).
// ---------------------------------------------------------------------------

import type { Notification, NotificationPrefs, NotifType } from "./types";

interface Store {
  prefs: NotificationPrefs;
  notifications: Notification[];
  seeded: boolean;
}

const g = globalThis as unknown as { __KAI_NOTIF_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_NOTIF_STORE__) {
    g.__KAI_NOTIF_STORE__ = {
      prefs: { emailDigest: false, kbReady: true, agentDone: true, securityAlert: true },
      notifications: [],
      seeded: false,
    };
  }
  return g.__KAI_NOTIF_STORE__;
}

function uid() {
  return `ntf_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Preferences ──────────────────────────────────────────────────────────

export function getPrefs(): NotificationPrefs {
  seed();
  return { ...store().prefs };
}

export function updatePrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  seed();
  const s = store();
  s.prefs = { ...s.prefs, ...patch };
  return { ...s.prefs };
}

function isChannelEnabled(type: NotifType): boolean {
  return store().prefs[type];
}

// ── Notifications ────────────────────────────────────────────────────────

/** Create a notification (only if the channel is enabled). Returns the
 *  notification or null if the channel is disabled. */
export function notify(
  type: NotifType,
  title: string,
  body: string,
  link?: string
): Notification | null {
  seed();
  if (!isChannelEnabled(type)) return null;
  const n: Notification = {
    id: uid(),
    type,
    title,
    body,
    read: false,
    createdAt: Date.now(),
    link,
  };
  store().notifications.unshift(n);
  // keep max 50
  if (store().notifications.length > 50) {
    store().notifications = store().notifications.slice(0, 50);
  }
  return n;
}

export function listNotifications(limit?: number): Notification[] {
  seed();
  const all = [...store().notifications].sort((a, b) => b.createdAt - a.createdAt);
  return limit ? all.slice(0, limit) : all;
}

export function markRead(id: string): void {
  seed();
  const n = store().notifications.find((x) => x.id === id);
  if (n) n.read = true;
}

export function markAllRead(): void {
  seed();
  store().notifications.forEach((n) => (n.read = true));
}

export function unreadCount(): number {
  seed();
  return store().notifications.filter((n) => !n.read).length;
}

export function deleteNotification(id: string): boolean {
  seed();
  const s = store();
  const idx = s.notifications.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  s.notifications.splice(idx, 1);
  return true;
}

// ── Seed demo data ───────────────────────────────────────────────────────

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;

  const demos: Array<Omit<Notification, "id" | "read">> = [
    {
      type: "kbReady",
      title: "知识库「产品文档」处理完成",
      body: "3 篇文档已成功向量化，共生成 518 个文本块，可以开始问答了。",
      createdAt: now - 5 * min,
      link: "/knowledge-base",
    },
    {
      type: "agentDone",
      title: "Agent 调研报告已完成",
      body: "「2026 AI 就业市场调研」报告已生成，耗时 2 分 14 秒。",
      createdAt: now - 2 * hr,
      link: "/agent",
    },
    {
      type: "securityAlert",
      title: "检测到新设备登录",
      body: "您的账号在 Chrome / macOS 上登录，IP: 117.136.x.x。如非本人操作请立即修改密码。",
      createdAt: now - 5 * hr,
      link: "/settings",
    },
    {
      type: "emailDigest",
      title: "每周用量摘要",
      body: "上周共进行 128 次问答、3 次 Agent 调研、上传 12 篇文档。",
      createdAt: now - 2 * day,
      link: "/usage",
    },
  ];

  for (const d of demos) {
    store().notifications.push({ ...d, id: uid(), read: false });
  }
}
