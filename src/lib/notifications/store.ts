// ---------------------------------------------------------------------------
// Notification Store - preferences + in-app notification inbox.
// Per-user isolated: every user has their own preferences and inbox.
// 🔌 Production: replace with DB + email worker (Resend/SendGrid) + cron for
//    weekly digest.  In-app notifications -> push (Web Push / FCM).
// ---------------------------------------------------------------------------

import type { Notification, NotificationPrefs, NotifType } from "./types";

interface Store {
  prefsByUser: Map<string, NotificationPrefs>;
  notificationsByUser: Map<string, Notification[]>;
  seededUsers: Set<string>;
}

const g = globalThis as unknown as { __KAI_NOTIF_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_NOTIF_STORE__ || !g.__KAI_NOTIF_STORE__.seededUsers) {
    // HMR migration: reset singletons created by an older store revision.
    g.__KAI_NOTIF_STORE__ = {
      prefsByUser: new Map(),
      notificationsByUser: new Map(),
      seededUsers: new Set(),
    };
  }
  return g.__KAI_NOTIF_STORE__;
}

function uid() {
  return `ntf_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultPrefs(): NotificationPrefs {
  return { emailDigest: false, kbReady: true, agentDone: true, securityAlert: true };
}

// ── Preferences ──────────────────────────────────────────────────────────

export function getPrefs(userId: string): NotificationPrefs {
  ensureSeed(userId);
  const s = store();
  let p = s.prefsByUser.get(userId);
  if (!p) {
    p = defaultPrefs();
    s.prefsByUser.set(userId, p);
  }
  return { ...p };
}

export function updatePrefs(
  userId: string,
  patch: Partial<NotificationPrefs>
): NotificationPrefs {
  ensureSeed(userId);
  const s = store();
  const p = { ...defaultPrefs(), ...s.prefsByUser.get(userId), ...patch };
  s.prefsByUser.set(userId, p);
  return { ...p };
}

function isChannelEnabled(userId: string, type: NotifType): boolean {
  return getPrefs(userId)[type];
}

function inbox(userId: string): Notification[] {
  ensureSeed(userId);
  const s = store();
  let list = s.notificationsByUser.get(userId);
  if (!list) {
    list = [];
    s.notificationsByUser.set(userId, list);
  }
  return list;
}

// ── Notifications ────────────────────────────────────────────────────────

/** Create a notification for a user (only if their channel is enabled). */
export function notify(
  userId: string,
  type: NotifType,
  title: string,
  body: string,
  link?: string
): Notification | null {
  if (!userId) return null;
  ensureSeed(userId);
  if (!isChannelEnabled(userId, type)) return null;
  const n: Notification = {
    id: uid(),
    type,
    title,
    body,
    read: false,
    createdAt: Date.now(),
    link,
  };
  const list = inbox(userId);
  list.unshift(n);
  if (list.length > 50) ssplice(list, 0, list.length - 50);
  return n;
}

// in-place truncate helper (keeps the most recent 50)
function ssplice(arr: Notification[], start: number, deleteCount: number) {
  arr.splice(start, deleteCount);
}

export function listNotifications(userId: string, limit?: number): Notification[] {
  ensureSeed(userId);
  const all = [...inbox(userId)].sort((a, b) => b.createdAt - a.createdAt);
  return limit ? all.slice(0, limit) : all;
}

export function markRead(userId: string, id: string): void {
  ensureSeed(userId);
  const n = inbox(userId).find((x) => x.id === id);
  if (n) n.read = true;
}

export function markAllRead(userId: string): void {
  ensureSeed(userId);
  inbox(userId).forEach((n) => (n.read = true));
}

export function unreadCount(userId: string): number {
  ensureSeed(userId);
  return inbox(userId).filter((n) => !n.read).length;
}

export function deleteNotification(userId: string, id: string): boolean {
  ensureSeed(userId);
  const list = inbox(userId);
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

// ── Seed demo data (per user, on first access) ──────────────────────────

function ensureSeed(userId: string) {
  const s = store();
  if (s.seededUsers.has(userId)) return;
  s.seededUsers.add(userId);
  if (!s.prefsByUser.has(userId)) s.prefsByUser.set(userId, defaultPrefs());

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

  const list: Notification[] = [];
  for (const d of demos) list.push({ ...d, id: uid(), read: false });
  s.notificationsByUser.set(userId, list);
}
