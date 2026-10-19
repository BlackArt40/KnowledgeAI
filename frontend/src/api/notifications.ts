// 通知（AppShell 铃铛 + profile tab 偏好开关）。30s 轮询由 AppShell 负责。
import { api } from "./client";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  link?: string;
}

export interface NotificationList {
  notifications: Notification[];
  unread: number;
}

export interface NotifPrefs {
  emailDigest: boolean;
  kbReady: boolean;
  agentDone: boolean;
  securityAlert: boolean;
}

export function fetchNotifications(limit = 10): Promise<NotificationList> {
  return api.get<NotificationList>(`/api/notifications?limit=${limit}`);
}

export function markAllRead(): Promise<unknown> {
  return api.post("/api/notifications", { action: "markAllRead" });
}

export function markOneRead(id: string): Promise<unknown> {
  return api.patch(`/api/notifications/${id}/read`);
}

export async function fetchNotifPrefs(): Promise<NotifPrefs | null> {
  const d = await api.get<{ prefs?: NotifPrefs }>("/api/notifications/preferences");
  return d?.prefs ?? null;
}

export function patchNotifPref(key: keyof NotifPrefs, val: boolean): Promise<unknown> {
  return api.patch("/api/notifications/preferences", { [key]: val });
}
