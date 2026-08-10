// ---------------------------------------------------------------------------
// Centralized configuration & provider status.
// Used by the admin panel to show which production providers are active.
// ---------------------------------------------------------------------------

import { isLLMEnabled, embeddingModel, llmLabel } from "@/lib/llm/provider";
import { isPaymentEnabled, paymentLabel } from "@/lib/billing/provider";
import { isStorageEnabled } from "@/lib/storage";
import { isDbEnabled } from "@/lib/db/client";
import { isExternalEnabled, externalLabel } from "@/lib/external";
import { getRateLimitLimits, isDistributedRateLimit } from "@/lib/security/rate-limit";

export interface ProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
  envVars: string[];
}

export async function getProviderStatus(): Promise<ProviderStatus[]> {
  const llmOn = await isLLMEnabled();
  const lbl = llmOn ? await llmLabel() : "本地抽取式（演示模式）";
  const emb = llmOn ? await embeddingModel() : "本地哈希嵌入 2048 维（演示模式）";
  return [
    {
      id: "llm",
      label: "LLM 对话模型",
      enabled: llmOn,
      detail: lbl,
      envVars: ["OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"],
    },
    {
      id: "embedding",
      label: "嵌入模型",
      enabled: llmOn,
      detail: emb,
      envVars: ["OPENAI_API_KEY", "EMBEDDING_MODEL"],
    },
    {
      id: "database",
      label: "数据库",
      enabled: isDbEnabled(),
      detail: isDbEnabled() ? "PostgreSQL (Prisma)" : "内存存储（演示模式）",
      envVars: ["DATABASE_URL"],
    },
    {
      id: "storage",
      label: "文件存储",
      enabled: isStorageEnabled(),
      detail: isStorageEnabled() ? `S3: ${process.env.S3_BUCKET}` : "本地文件系统（演示模式）",
      envVars: ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY"],
    },
    {
      id: "payment",
      label: "支付网关",
      enabled: isPaymentEnabled(),
      detail: isPaymentEnabled() ? paymentLabel() : "模拟支付（演示模式）",
      envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    },
    {
      id: "ratelimit",
      label: "限流",
      enabled: true,
      detail: (() => {
        const l = getRateLimitLimits();
        return `分级 ${l.base}/${l.anon}/${l.key}/${l.kb} 次/分（用户/匿名/API Key/KB）· ${isDistributedRateLimit() ? "Redis 分布式" : "内存单实例"}`;
      })(),
      envVars: ["RATE_LIMIT_PER_MIN", "RATE_LIMIT_ANON_PER_MIN", "RATE_LIMIT_KEY_PER_MIN", "RATE_LIMIT_KB_PER_MIN"],
    },
    {
      id: "external",
      label: "外部数据源",
      enabled: isExternalEnabled(),
      detail: isExternalEnabled() ? externalLabel() : "演示模式（模拟结果）",
      envVars: ["TAVILY_API_KEY", "SERPAPI_KEY", "BRAVE_SEARCH_KEY", "GITHUB_TOKEN"],
    },
  ];
}

export async function getEnabledCount(): Promise<{ enabled: number; total: number }> {
  const providers = await getProviderStatus();
  return {
    enabled: providers.filter((p) => p.enabled).length,
    total: providers.length,
  };
}
