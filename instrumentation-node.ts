// ---------------------------------------------------------------------------
// Node.js-only instrumentation entrypoint.
//
// Imported by instrumentation.ts only when NEXT_RUNTIME === "nodejs". Keeps
// process.on / process.exit out of the Edge-compiled instrumentation.ts so
// the Edge Runtime compiler doesn't reject them.
// ---------------------------------------------------------------------------

import { startQueue, stopQueue } from "@/lib/queue";
import { recoverInterruptedJobs } from "@/lib/queue/recovery";
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

// P1: with Redis a separate worker process owns consumption. Starting a
// consumer here too doubles concurrency and lets long jobs run in the web
// process. Memory mode has no other process, so it consumes in-process.
// QUEUE_CONSUMER=web forces web consumption for single-process Redis setups.
// P2: blank string (copied from .env.example) counts as unset - auto-select.
const externalQueue = !!process.env.REDIS_URL;
const configuredRole = (process.env.QUEUE_CONSUMER ?? "").trim();
const consumerRole = (configuredRole || (externalQueue ? "worker" : "web")).toLowerCase();
if (consumerRole === "web") {
  log.info("[instrumentation] Starting background queue worker (in-process)...");
  startQueue();
  void recoverInterruptedJobs().catch((err) => log.error({ err }, "[instrumentation] queue recovery failed"));
} else {
  log.info("[instrumentation] Queue consumer delegated to worker process (QUEUE_CONSUMER=worker).");
}

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
