// ---------------------------------------------------------------------------
// Centralized configuration & provider status.
// Used by the admin panel to show which production providers are active.
// ---------------------------------------------------------------------------

import { isLLMEnabled, chatModel, embeddingModel, llmLabel } from "@/lib/llm/provider";
import { isPaymentEnabled, paymentLabel } from "@/lib/billing/provider";
import { isStorageEnabled } from "@/lib/storage";
import { isDbEnabled } from "@/lib/db/client";

export interface ProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
  envVars: string[];
}

export function getProviderStatus(): ProviderStatus[] {
  return [
    {
      id: "llm",
      label: "LLM 对话模型",
      enabled: isLLMEnabled(),
      detail: isLLMEnabled() ? llmLabel() : "本地抽取式（演示模式）",
      envVars: ["OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"],
    },
    {
      id: "embedding",
      label: "嵌入模型",
      enabled: isLLMEnabled(),
      detail: isLLMEnabled() ? embeddingModel() : "本地哈希嵌入 2048 维（演示模式）",
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
      detail: `${process.env.RATE_LIMIT_PER_MIN || 60} 次/分钟`,
      envVars: ["RATE_LIMIT_PER_MIN"],
    },
  ];
}

export function getEnabledCount(): { enabled: number; total: number } {
  const providers = getProviderStatus();
  return {
    enabled: providers.filter((p) => p.enabled).length,
    total: providers.length,
  };
}
