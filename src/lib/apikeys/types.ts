export type KeyStatus = "active" | "disabled";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string; // visible prefix, e.g. "kai_sk_…3f2a"
  secret: string; // full key (only shown once)
  scopes: string[];
  status: KeyStatus;
  createdAt: number;
  lastUsed: number | null;
  calls: number;
}

export interface CallLog {
  id: string;
  keyId: string;
  endpoint: string;
  method: string;
  status: number;
  ts: number;
  latencyMs: number;
}

export const SCOPES = [
  { id: "kb:read", label: "知识库读取" },
  { id: "kb:write", label: "知识库写入" },
  { id: "chat:read", label: "问答调用" },
  { id: "agent:run", label: "Agent 调研" },
  { id: "team:read", label: "团队信息" },
] as const;
