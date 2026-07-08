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

export const NOTIF_META: Record<NotifType, { label: string; desc: string; icon: string }> = {
  emailDigest: {
    label: "每周用量摘要邮件",
    desc: "每周一收到上周的使用统计",
    icon: "Mail",
  },
  kbReady: {
    label: "知识库处理完成通知",
    desc: "文档向量化完成时邮件提醒",
    icon: "Library",
  },
  agentDone: {
    label: "Agent 报告完成通知",
    desc: "调研报告生成完成时提醒",
    icon: "Bot",
  },
  securityAlert: {
    label: "安全告警",
    desc: "异常登录或权限变更时立即通知",
    icon: "ShieldAlert",
  },
};
