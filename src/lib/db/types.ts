// ---------------------------------------------------------------------------
// Prisma type stubs - allows the codebase to compile without @prisma/client.
// When @prisma/client is installed, these are superseded by real types.
// ---------------------------------------------------------------------------

export interface PrismaUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  role: string;
  status: string;
  plan: string;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaKb {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  teamId: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaDoc {
  id: string;
  kbId: string;
  name: string;
  size: number;
  type: string;
  status: string;
  progress: number;
  content: string | null;
  url: string | null;
  chunks: number;
  uploadedAt: Date;
  updatedAt: Date;
}

export interface PrismaConversation {
  id: string;
  kbId: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  citations: unknown;
  createdAt: Date;
}

export interface PrismaAgentTask {
  id: string;
  userId: string;
  topic: string;
  kbId: string | null;
  outputFormat: string;
  status: string;
  report: string | null;
  outline: unknown;
  citations: unknown;
  steps: unknown;
  durationMs: number | null;
  createdAt: Date;
}

export interface PrismaApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  status: string;
  calls: number;
  lastUsed: Date | null;
  createdAt: Date;
}

export interface PrismaSubscription {
  id: string;
  userId: string;
  plan: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  paymentMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaInvoice {
  id: string;
  userId: string;
  amount: number;
  plan: string;
  status: string;
  method: string;
  date: Date;
}

export interface PrismaSession {
  id: string;
  userId: string;
  token: string;
  device: string;
  browser: string;
  ip: string;
  location: string | null;
  lastActive: Date;
  expiresAt: Date;
}

export interface PrismaLoginEvent {
  id: string;
  userId: string;
  device: string;
  ip: string;
  location: string | null;
  success: boolean;
  createdAt: Date;
}

// Prisma client shape (subset of methods we use)
export interface PrismaClient {
  user: {
    findUnique(opts: { where: { id?: string; email?: string } }): Promise<PrismaUser | null>;
    findMany(opts?: { orderBy?: unknown }): Promise<PrismaUser[]>;
    create(opts: { data: unknown }): Promise<PrismaUser>;
    update(opts: { where: { id: string }; data: unknown }): Promise<PrismaUser>;
    delete(opts: { where: { id: string } }): Promise<PrismaUser>;
    count(opts?: unknown): Promise<number>;
  };
  knowledgeBase: {
    findUnique(opts: { where: { id: string } }): Promise<PrismaKb | null>;
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaKb[]>;
    create(opts: { data: unknown }): Promise<PrismaKb>;
    update(opts: { where: { id: string }; data: unknown }): Promise<PrismaKb>;
    delete(opts: { where: { id: string } }): Promise<PrismaKb>;
  };
  kbDocument: {
    findUnique(opts: { where: { id: string } }): Promise<PrismaDoc | null>;
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaDoc[]>;
    create(opts: { data: unknown }): Promise<PrismaDoc>;
    update(opts: { where: { id: string }; data: unknown }): Promise<PrismaDoc>;
    delete(opts: { where: { id: string } }): Promise<PrismaDoc>;
  };
  conversation: {
    findUnique(opts: { where: { id: string } }): Promise<PrismaConversation | null>;
    findMany(opts?: { where?: unknown; orderBy?: unknown; take?: number }): Promise<PrismaConversation[]>;
    create(opts: { data: unknown }): Promise<PrismaConversation>;
    delete(opts: { where: { id: string } }): Promise<PrismaConversation>;
  };
  message: {
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaMessage[]>;
    create(opts: { data: unknown }): Promise<PrismaMessage>;
    delete(opts: { where: { conversationId: string } }): Promise<unknown>;
  };
  agentTask: {
    findUnique(opts: { where: { id: string } }): Promise<PrismaAgentTask | null>;
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaAgentTask[]>;
    create(opts: { data: unknown }): Promise<PrismaAgentTask>;
    update(opts: { where: { id: string }; data: unknown }): Promise<PrismaAgentTask>;
    delete(opts: { where: { id: string } }): Promise<PrismaAgentTask>;
  };
  apiKey: {
    findUnique(opts: { where: { id?: string; keyHash?: string } }): Promise<PrismaApiKey | null>;
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaApiKey[]>;
    create(opts: { data: unknown }): Promise<PrismaApiKey>;
    update(opts: { where: { id: string }; data: unknown }): Promise<PrismaApiKey>;
    delete(opts: { where: { id: string } }): Promise<PrismaApiKey>;
  };
  subscription: {
    findUnique(opts: { where: { userId: string } }): Promise<PrismaSubscription | null>;
    create(opts: { data: unknown }): Promise<PrismaSubscription>;
    update(opts: { where: { userId: string }; data: unknown }): Promise<PrismaSubscription>;
  };
  invoice: {
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaInvoice[]>;
    create(opts: { data: unknown }): Promise<PrismaInvoice>;
  };
  session: {
    findMany(opts?: { where?: unknown }): Promise<PrismaSession[]>;
    create(opts: { data: unknown }): Promise<PrismaSession>;
    delete(opts: { where: { id?: string; token?: string } }): Promise<PrismaSession>;
  };
  loginEvent: {
    findMany(opts?: { where?: unknown; orderBy?: unknown }): Promise<PrismaLoginEvent[]>;
    create(opts: { data: unknown }): Promise<PrismaLoginEvent>;
  };
  $queryRaw<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
  $executeRaw(sql: string, ...params: unknown[]): Promise<number>;
}

// ── Additional model interfaces ──────────────────────────────────────────

export interface PrismaNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  link: string | null;
  createdAt: Date;
}

export interface PrismaNotificationPrefs {
  userId: string;
  emailDigest: boolean;
  kbReady: boolean;
  agentDone: boolean;
  securityAlert: boolean;
}

export interface PrismaModelConfig {
  id: string;
  userId: string;
  name: string;
  provider: string;
  providerName: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
}

export interface PrismaOrder {
  id: string;
  userId: string;
  plan: string;
  amount: number;
  method: string;
  status: string;
  createdAt: Date;
}
