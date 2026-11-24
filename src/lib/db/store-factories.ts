// Canonical empty shapes for every globalThis in-memory store.
//
// Both the domain store (store()) and hydrate.ts use these factories. This is
// the single place where a new field/default must be added; otherwise DB
// hydration can silently create a different shape than the runtime store.
import type { SystemConfig } from "@kai/shared/admin/types";
import type { AgentTask } from "@kai/shared/agent/types";
import type { ApiKey, CallLog } from "@/lib/apikeys/types";
import type { User } from "@/lib/auth/store";
import type { Invoice, Order, Subscription, Usage } from "@kai/shared/billing/types";
import type { Conversation } from "@/lib/chat/store";
import type { KbDocument, KnowledgeBase } from "@/lib/kb/types";
import type { GraphEntity, GraphRelation } from "@kai/shared/kg/types";
import type { ModelConfig } from "@/lib/models/types";
import type { Notification, NotificationPrefs } from "@/lib/notifications/types";
import type { SecurityState } from "@/lib/security/types";
import type { AuditEntry, KbAccess, KbMemberRole, Member, Team } from "@/lib/team/types";
import type { UploadSession } from "@/lib/upload/store";
import type { DeliveryRecord, WebhookSubscription } from "@/lib/webhooks/types";
import type { Workspace } from "@/lib/workspace/store";

export interface AdminStore { config: SystemConfig }
export interface AgentStore { tasks: Map<string, AgentTask> }
export interface ApiKeyStore { keys: ApiKey[]; logs: CallLog[] }
export interface AuthStore { users: Map<string, User>; emailIndex: Map<string, string>; seeded: boolean }
export interface BillingStore {
  subscriptionsByUser: Map<string, Subscription>;
  invoicesByUser: Map<string, Invoice[]>;
  orders: Map<string, Order & { userId: string }>;
  usageByUser: Map<string, Usage>;
  seeded: boolean;
}
export interface ChatStore { conversations: Map<string, Conversation> }
export interface KbStore { kbs: Map<string, KnowledgeBase>; docs: Map<string, KbDocument>; seeded: boolean }
export interface KgStore {
  entities: Map<string, GraphEntity>;
  relations: Map<string, GraphRelation>;
  labelIndex: Map<string, string>;
  docGraphs: Map<string, Map<string, { entityIds: string[]; relationIds: string[]; entityMentions: Map<string, number> }>>;
}
export type ModelStore = Map<string, Map<string, ModelConfig>>;
export interface NotificationStore {
  prefsByUser: Map<string, NotificationPrefs>;
  notificationsByUser: Map<string, Notification[]>;
  seededUsers: Set<string>;
  hydrated?: boolean;
}
export type SecurityUserState = SecurityState & { seeded: boolean; authVersion?: number };
export interface SecurityStore { byUser: Map<string, SecurityUserState> }
export interface TeamStore {
  team: Team;
  members: Map<string, Member>;
  audit: AuditEntry[];
  kbAccess: Map<string, KbAccess>;
  kbMemberRoles: Map<string, Record<string, KbMemberRole>>;
  seeded: boolean;
}
export type UploadStore = Map<string, UploadSession>;
export interface WebhookStore { subs: Map<string, WebhookSubscription>; deliveries: DeliveryRecord[] }
export type WorkspaceStore = Map<string, Workspace>;

export function createEmptyAdminStore(): AdminStore {
  return {
    config: {
      defaultModel: "gpt-4o",
      embeddingModel: "bge-m3",
      rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10),
      maxUploadMb: 50,
      maintenanceMode: false,
      allowSignup: true,
      required2FARoles: [],
    },
  };
}

export function createEmptyAgentStore(): AgentStore {
  return { tasks: new Map() };
}

export function createEmptyApiKeyStore(): ApiKeyStore {
  return { keys: [], logs: [] };
}

export function createEmptyAuthStore(): AuthStore {
  return { users: new Map(), emailIndex: new Map(), seeded: false };
}

export function createEmptyBillingStore(seeded = false): BillingStore {
  return {
    subscriptionsByUser: new Map(),
    invoicesByUser: new Map(),
    orders: new Map(),
    usageByUser: new Map(),
    seeded,
  };
}

export function createEmptyChatStore(): ChatStore {
  return { conversations: new Map() };
}

export function createEmptyKbStore(): KbStore {
  return { kbs: new Map(), docs: new Map(), seeded: false };
}

export function createEmptyKgStore(): KgStore {
  return { entities: new Map(), relations: new Map(), labelIndex: new Map(), docGraphs: new Map() };
}

export function createEmptyModelStore(): ModelStore {
  return new Map();
}

export function createEmptyNotificationStore(): NotificationStore {
  return {
    prefsByUser: new Map(),
    notificationsByUser: new Map(),
    seededUsers: new Set(),
    hydrated: false,
  };
}

export function createEmptySecurityStore(): SecurityStore {
  return { byUser: new Map() };
}

export function createEmptyTeamStore(): TeamStore {
  return {
    team: {
      id: "team_default",
      name: "KnowledgeAI 团队",
      logoInitial: "K",
      plan: "专业版",
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    },
    members: new Map(),
    audit: [],
    kbAccess: new Map(),
    kbMemberRoles: new Map(),
    seeded: false,
  };
}

export function createEmptyUploadStore(): UploadStore {
  return new Map();
}

export function createEmptyWebhookStore(): WebhookStore {
  return { subs: new Map(), deliveries: [] };
}

export function createEmptyWorkspaceStore(): WorkspaceStore {
  const ws: Workspace = {
    id: "ws_default",
    name: "KnowledgeAI 团队",
    plan: "pro",
    ownerId: "usr_owner",
    members: [
      "owner@knowledgeai.dev",
      "admin@knowledgeai.dev",
      "editor@knowledgeai.dev",
      "viewer@knowledgeai.dev",
    ],
    createdAt: Date.now() - 90 * 86_400_000,
    brandColor: "indigo",
  };
  return new Map([[ws.id, ws]]);
}
