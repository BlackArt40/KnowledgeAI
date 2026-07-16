// ---------------------------------------------------------------------------
// Model Config Store - per-user external LLM provider configurations.
// 🔌 Production: replace globalThis store with encrypted DB rows (Prisma)
//    scoped by userId.
// ---------------------------------------------------------------------------

import type { ModelConfig, ModelConfigSafe, ProviderPreset, ProviderId } from "./types";
import { deleteModelConfigFromDb } from "@/lib/db/persist";

// ── Provider presets ────────────────────────────────────────────────────

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    keyPlaceholder: "sk-...",
    chatModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    keyHint: "在 platform.openai.com 创建 API Key",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://platform.deepseek.com/api_keys",
    needsKey: true,
    keyPlaceholder: "sk-...",
    chatModels: ["deepseek-chat", "deepseek-reasoner"],
    embeddingModels: [],
    keyHint: "在 platform.deepseek.com 创建 API Key",
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    needsKey: true,
    keyPlaceholder: "sk-...",
    chatModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    embeddingModels: [],
    keyHint: "在 platform.moonshot.cn 创建 API Key",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    docsUrl: "https://cloud.siliconflow.cn/account/ak",
    needsKey: true,
    keyPlaceholder: "sk-...",
    chatModels: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
    embeddingModels: ["BAAI/bge-large-zh-v1.5", "BAAI/bge-m3"],
    keyHint: "在 cloud.siliconflow.cn 创建 API Key",
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    baseUrl: "http://localhost:11434/v1",
    docsUrl: "https://ollama.com/download",
    needsKey: false,
    keyPlaceholder: "ollama（留空即可）",
    chatModels: ["llama3.1", "qwen2.5", "mistral", "gemma2"],
    embeddingModels: ["nomic-embed-text"],
    keyHint: "本地运行无需 Key，确保 ollama serve 已启动",
  },
  {
    id: "custom",
    name: "自定义 (OpenAI 兼容)",
    baseUrl: "",
    docsUrl: "",
    needsKey: true,
    keyPlaceholder: "sk-...",
    chatModels: [],
    embeddingModels: [],
    keyHint: "填写任意 OpenAI 兼容端点（vLLM / Azure / LM Studio 等）",
  },
];

export function getProvider(id: ProviderId): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// ── Per-user store ───────────────────────────────────────────────────────
// Outer map: userId -> (inner map: modelId -> ModelConfig)

type Store = Map<string, Map<string, ModelConfig>>;
const g = globalThis as unknown as { __KAI_MODEL_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_MODEL_STORE__) g.__KAI_MODEL_STORE__ = new Map();
  return g.__KAI_MODEL_STORE__;
}

/** Get or create the inner map for a user. */
function userModels(userId: string): Map<string, ModelConfig> {
  const s = store();
  let m = s.get(userId);
  if (!m) {
    m = new Map();
    s.set(userId, m);
  }
  return m;
}

function uid() {
  return `mdl_${Math.random().toString(36).slice(2, 10)}`;
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function sanitize(m: ModelConfig): ModelConfigSafe {
  const { apiKey, ...rest } = m;
  return { ...rest, apiKeyMasked: maskKey(apiKey), hasKey: !!apiKey };
}

// ── CRUD (all scoped by userId) ──────────────────────────────────────────

export function listModels(userId: string): ModelConfig[] {
  return [...userModels(userId).values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function listModelsSafe(userId: string): ModelConfigSafe[] {
  return listModels(userId).map(sanitize);
}

export function getModel(userId: string, id: string): ModelConfig | null {
  return userModels(userId).get(id) ?? null;
}

export interface CreateModelInput {
  name: string;
  provider: ProviderId;
  apiKey?: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel?: string;
}

export function createModel(
  userId: string,
  input: CreateModelInput
): ModelConfig | { error: string } {
  const preset = getProvider(input.provider);
  const providerName = preset?.name ?? input.provider;
  const name = input.name.trim() || `${providerName} · ${input.chatModel}`;

  if (!input.baseUrl.trim()) return { error: "Base URL 不能为空" };
  if (!input.chatModel.trim()) return { error: "对话模型不能为空" };
  if (preset?.needsKey && !input.apiKey?.trim()) {
    return { error: "该提供商需要 API Key" };
  }

  const m: ModelConfig = {
    id: uid(),
    userId,
    name,
    provider: input.provider,
    providerName,
    apiKey: input.apiKey?.trim() ?? "",
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    chatModel: input.chatModel.trim(),
    embeddingModel: input.embeddingModel?.trim() ?? "",
    enabled: false,
    isDefault: false,
    lastTestedAt: null,
    lastTestOk: null,
    createdAt: Date.now(),
  };
  userModels(userId).set(m.id, m);
  return m;
}

export interface UpdateModelInput {
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  chatModel?: string;
  embeddingModel?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export function updateModel(
  userId: string,
  id: string,
  patch: UpdateModelInput
): ModelConfig | { error: string } {
  const models = userModels(userId);
  const m = models.get(id);
  if (!m) return { error: "模型配置不存在" };

  if (patch.name !== undefined) m.name = patch.name.trim() || m.name;
  if (patch.apiKey !== undefined) m.apiKey = patch.apiKey.trim();
  if (patch.baseUrl !== undefined) m.baseUrl = patch.baseUrl.trim().replace(/\/$/, "");
  if (patch.chatModel !== undefined) m.chatModel = patch.chatModel.trim();
  if (patch.embeddingModel !== undefined) m.embeddingModel = patch.embeddingModel.trim();
  if (patch.enabled !== undefined) m.enabled = patch.enabled;

  if (patch.isDefault) {
    for (const other of models.values()) {
      if (other.id !== id) other.isDefault = false;
    }
    m.isDefault = true;
    m.enabled = true;
  }

  models.set(id, m);
  return m;
}

export function deleteModel(userId: string, id: string): boolean {
  void deleteModelConfigFromDb(id);
  return userModels(userId).delete(id);
}

export function setTestResult(userId: string, id: string, ok: boolean) {
  const m = userModels(userId).get(id);
  if (!m) return;
  m.lastTestedAt = Date.now();
  m.lastTestOk = ok;
}

/** The active model config for a user.
 *  Priority: default+enabled > first enabled > null (env fallback). */
export function getActiveModelForUser(userId: string): ModelConfig | null {
  const models = listModels(userId);
  const def = models.find((m) => m.isDefault && m.enabled);
  if (def) return def;
  return models.find((m) => m.enabled) ?? null;
}
