// ---------------------------------------------------------------------------
// Node.js-only instrumentation entrypoint.
//
// Imported by instrumentation.ts only when NEXT_RUNTIME === "nodejs". Keeps
// process.on / process.exit out of the Edge-compiled instrumentation.ts so
// the Edge Runtime compiler doesn't reject them.
// ---------------------------------------------------------------------------

import { startQueue, stopQueue } from "@/lib/queue";
import { log } from "./src/lib/obs/log";

// P0-2 fail-fast: getAuthSecret() skips its throw during `next build`, so
// production boot must assert the secret here - before any queue job can
// sign / encrypt with the hardcoded dev fallback.
if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) {
  log.error("[instrumentation] AUTH_SECRET 未配置：生产环境拒绝启动");
  throw new Error(
    "AUTH_SECRET 未配置：生产环境拒绝启动（JWT 签名 / AES 加密 / 审计 HMAC 共用该密钥，缺省回退硬编码密钥可导致任意账号伪造与敏感数据解密）"
  );
}

log.info("[instrumentation] Starting background queue worker...");
startQueue();

const shutdown = async () => {
  log.info("[instrumentation] Shutting down queue worker...");
  try {
    await stopQueue();
  } catch {
    // ignore -- best-effort cleanup
  }
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
