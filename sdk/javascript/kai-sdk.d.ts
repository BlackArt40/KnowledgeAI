// Type definitions for the KnowledgeAI JavaScript SDK (kai-sdk.mjs).

export interface KnowledgeAIOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface AskOptions {
  onToken?: (token: string) => void;
  onSources?: (sources: unknown[]) => void;
  signal?: AbortSignal;
  webSearch?: boolean;
}

export interface AgentOptions {
  onStep?: (step: unknown) => void;
}

export interface AskResult {
  messageId: string | null;
  conversationId: string;
  citations: unknown[];
  followUps: unknown[];
}

export class KnowledgeAIError extends Error {
  status: number;
  body: unknown;
}

export class KnowledgeAI {
  constructor(opts: KnowledgeAIOptions);
  me(): Promise<{ user: { id: string; email: string; name: string; role: string; workspaceId: string } }>;
  listKnowledgeBases(): Promise<{ kbs: unknown[] }>;
  createKnowledgeBase(opts: { name: string; desc?: string; color?: string }): Promise<{ kb: unknown }>;
  ask(kbId: string, query: string, opts?: AskOptions): Promise<AskResult>;
  runAgent(topic: string, opts?: AgentOptions): Promise<unknown>;
  listWebhooks(): Promise<{ webhooks: unknown[] }>;
  createWebhook(opts: { name?: string; url: string; secret?: string; events: string[] }): Promise<{ webhook: unknown }>;
  deleteWebhook(id: string): Promise<{ ok: boolean }>;
}

export default KnowledgeAI;
