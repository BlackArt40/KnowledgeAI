// ---------------------------------------------------------------------------
// Notification system types.
// 5 notification channels: weekly digest, KB ready, Agent done, security alert,
// team activity (permission / sharing / membership changes).
// ---------------------------------------------------------------------------

export type NotifType =
  | "emailDigest"
  | "kbReady"
  | "agentDone"
  | "securityAlert"
  | "teamActivity";

export interface NotificationPrefs {
  emailDigest: boolean;
  kbReady: boolean;
  agentDone: boolean;
  securityAlert: boolean;
  teamActivity: boolean;
}

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  link?: string;
}
