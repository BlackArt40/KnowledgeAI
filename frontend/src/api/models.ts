// 用户自定义模型（settings/models tab）。apiKey 只存掩码（服务端加密），
// 前端永不回显明文。
import { api } from "./client";

export interface ModelConfigSafe {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  apiKeyMasked: string;
  hasKey: boolean;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: number | null;
  lastTestOk: boolean | null;
  createdAt: number;
}

export interface ProviderPreset {
  id: string;
  name: string;
  chatModels: string[];
  embeddingModels: string[];
}

export interface ModelList {
  models: ModelConfigSafe[];
  providers: ProviderPreset[];
}

export function fetchModels(): Promise<ModelList> {
  return api.get<ModelList>("/api/models");
}

export function patchModel(id: string, body: Record<string, unknown>): Promise<unknown> {
  return api.patch(`/api/models/${id}`, body);
}

export function removeModel(id: string): Promise<unknown> {
  return api.del(`/api/models/${id}`);
}

export function testModel(id: string): Promise<unknown> {
  return api.post("/api/models/test", { id });
}

export function createModel(body: Record<string, unknown>): Promise<unknown> {
  return api.post("/api/models", body);
}
