// ---------------------------------------------------------------------------
// Notification system types.
// 4 notification channels: weekly digest, KB ready, Agent done, security alert.
// ---------------------------------------------------------------------------

export type NotifType = "emailDigest" | "kbReady" | "agentDone" | "securityAlert";

export interface NotificationPrefs {
  emailDigest: boolean;
  kbReady: boolean;
  agentDone: boolean;
  securityAlert: boolean;
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


