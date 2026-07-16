# AGENTS.md

Compact guidance for OpenCode sessions working in this repo. Read this before editing.

## Commands

```bash
pnpm install              # install (uses pnpm@11.7.0, Node 22)
pnpm dev                  # dev server on :3000
pnpm build                # production build (output: "standalone")
pnpm lint                 # ESLint (next core-web-vitals + TS). NOT run in CI.
npx tsc --noEmit          # typecheck - this is what CI runs, not a script
```

### CI gate (`.github/workflows/ci.yml`)

CI does **not** run `lint` or tests. It runs, in order:

1. `npx prisma generate`
2. `npx tsc --noEmit`
3. `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code`  ← **fails if `schema.prisma` drifted from migrations**
4. `pnpm build`

So: run `pnpm lint` locally before pushing (CI won't catch it), and never edit `prisma/schema.prisma` without running `npx prisma migrate dev --name <descriptive>` to generate a matching migration. There is currently only one migration (`20260713022119_init`).

### Tests (not in CI, not Jest/Vitest)

`tests/<suite>/<suite>-test.mjs` are standalone Node scripts that hit a **live** `pnpm dev` server. Start the dev server first, then:

```bash
node tests/functional/functional-test.mjs    # ~5s, 25 page/flow checks
node tests/api/api-test.mjs                  # ~15s, 38 API routes incl. SSE
node tests/performance/performance-test.mjs  # ~120s, rate-limit window waits
```

Each script writes a Chinese-named Markdown report next to itself. They are smoke/integration checks, not unit tests - there is no unit test framework.

`scripts/test-*.ts` and `scripts/mock-pinecone-server.ts` are manual smoke scripts run via `npx tsx`; not part of any suite.

## Architecture: in-memory store + write-through DB (critical)

Reads always come from in-memory stores on `globalThis` (`__KAI_USER_STORE__`, `__KAI_KB_STORE__`, `__KAI_CHAT_STORE__`, `__KAI_AGENT_STORE__`, `__KAI_MODEL_STORE__`, `__KAI_NOTIF_STORE__`, `__KAI_TEAM_STORE__`, `__KAI_ADMIN_STORE__`, `__KAI_QUEUE_INSTANCE__`). PostgreSQL is a **persistence layer**, not the read path.

- `src/lib/*/store.ts` - the in-memory stores (source of truth for reads)
- `src/lib/db/hydrate.ts` - on first API request, loads DB rows into the stores (lazy, once)
- `src/lib/db/persist.ts` - fire-and-forget write-through on mutations (errors logged, not thrown)
- `src/lib/db/client.ts` - lazy Prisma singleton; returns `null` if `DATABASE_URL` unset or `@prisma/client` missing

**To add a new persisted entity you must touch all of:** store.ts (in-memory shape) -> persist.ts (write-through fn) -> hydrate.ts (load fn) -> `prisma/schema.prisma` -> new migration. Forgetting any one leaves the DB and memory out of sync.

When `DATABASE_URL` is unset, the app runs in pure demo mode (memory only, reset on restart). This is the default - don't assume a DB is present.

## Background job queue (P0-4)

Document processing and agent research run in a background queue, not in the request thread. Two backends, selected by `REDIS_URL`:
- **Memory** (default) - in-process, no persistence, `instrumentation-node.ts` starts it on boot
- **BullMQ + Redis** - multi-instance, retries, dead-letter queue, separate worker process

Key files:
- `src/lib/queue/index.ts` - factory + agent event bus (publish/subscribe for SSE relay)
- `src/lib/queue/handlers.ts` - `doc-process` (parse->chunk->index), `agent-run` (runTask + event publishing), `index-cleanup`
- `src/lib/queue/memory-queue.ts` - demo backend with retry (3 attempts, exponential backoff)
- `src/lib/queue/bullmq-queue.ts` - Redis backend
- `src/lib/queue/agent-bus-redis.ts` - Redis Pub/Sub for cross-process agent event relay
- `instrumentation.ts` + `instrumentation-node.ts` - server boot hook that starts the worker (split because Edge Runtime rejects `process.on`/`process.exit`)
- `worker.ts` - standalone worker process entrypoint (Docker `worker` service)

**Agent SSE flow**: `/api/agent/run` enqueues `agent-run`, then opens SSE subscribing to the agent event bus. The worker runs `runTask` and publishes `step`/`done`/`error`/`end` events. In memory mode this is an EventEmitter; with Redis it's Pub/Sub so the worker can run in a separate process. Event names (`init`/`step`/`done`) are asserted by tests - don't rename them.

**Adding a new job type**: add to `JobType` union in `interface.ts` -> write handler in `handlers.ts` -> register in `registerAllHandlers()` -> enqueue from the route handler. The MemoryQueue auto-starts on first enqueue (HMR-safe via `globalThis.__KAI_QUEUE_INSTANCE__`).

## Middleware is `src/proxy.ts`, not `middleware.ts`

Next.js 16 renamed the middleware file to `proxy.ts`. It does two things:

1. Triggers `ensureHydrated()` (fire-and-forget) on first non-`/_next` request.
2. Rate-limits `/api/*` with a sliding window (Redis if `REDIS_URL`, else in-memory).

`SKIP_PATHS` excludes SSE streams and high-frequency polls from rate limiting: `/api/chat`, `/api/agent/run`, `/api/billing/webhook`, `/api/notifications`, `/api/auth/me`. Add new SSE/poll endpoints here or they'll get 429'd.

## Provider fallback pattern

Every external dependency has an env-gated real implementation plus a demo fallback. Gate checks live in each module's `provider.ts` and are aggregated by `src/lib/config.ts` (used by the `/admin` status panel). Modules: LLM (`src/lib/llm`), embedding (`src/lib/rag`), DB, storage (`src/lib/storage`), payment (`src/lib/billing`), rate-limit, queue (`src/lib/queue`).

When adding a new external integration, follow the same shape: env check -> real impl -> fallback -> register in `getProviderStatus()`.

## Prisma specifics

- `@prisma/client` **is** a runtime dependency (despite the README saying `pnpm add` to enable). It's lazy-loaded only when `DATABASE_URL` is set. Listed in `next.config.ts` `serverExternalPackages`.
- `prisma/seed.ts` is `@ts-nocheck` - edits there won't break `tsc --noEmit`, but also won't get type checking.
- pgvector: the `KbChunk` model exists in `schema.prisma` but the `embedding` column is added via **raw SQL** (Prisma can't model the `vector` type). Requires `CREATE EXTENSION IF NOT EXISTS vector;` on the DB. See `src/lib/rag` vector store implementations (`memory` | `pgvector` | `chromadb` | `pinecone`).
- Seed demo data: `npx prisma db seed` (configured in `package.json` -> `prisma.seed`). Creates 4 demo users (password `password123`) + 5 KBs + 1 team.

## Conventions

- **TypeScript strict**, path alias `@/*` -> `./src/*`. No `as any` / `@ts-ignore` in app code (the `as unknown as` casts in `persist.ts`/`hydrate.ts` are a known smell for models not in the generated client types - match the existing pattern there rather than introducing `as any`).
- App Router under `src/app/`: route groups `(app)` (AppShell-wrapped workspace), `(auth)` (login/register/verify), plus top-level `api/`, `privacy/`, `terms/`, `maintenance/`.
- RBAC roles: `OWNER` / `ADMIN` / `EDITOR` / `VIEWER`. Guard via `src/lib/auth/guard.ts`. Self-registration defaults to `EDITOR`.
- SSE routes (`/api/chat`, `/api/agent/run`) emit `token` / `step` / `done` events; tests assert these event names - don't rename them.
- Not a monorepo: `pnpm-workspace.yaml` is only an `allowBuilds` allowlist for native builds (prisma engines, esbuild, sharp, etc.). Single package.
- Docker: `output: "standalone"` build copied into a minimal `node:22-alpine` runner. `docker compose up -d` brings up app + worker + Redis (port 6380).

## Demo logins (for manual QA)

All four share password `password123`:

| Email | Role |
| --- | --- |
| owner@knowledgeai.dev | OWNER |
| admin@knowledgeai.dev | ADMIN |
| editor@knowledgeai.dev | EDITOR |
| viewer@knowledgeai.dev | VIEWER |

## Key files to know

- `src/proxy.ts` - middleware (rate limit + hydration trigger)
- `instrumentation.ts` + `instrumentation-node.ts` - server boot hook (starts queue worker)
- `src/lib/config.ts` - provider status aggregator (admin panel source of truth)
- `src/lib/queue/` - background job queue (doc-process, agent-run, index-cleanup)
- `src/lib/db/{client,hydrate,persist}.ts` - the DB adaptation triad
- `src/lib/auth/guard.ts` - RBAC role guard for route handlers
- `prisma/schema.prisma` + `prisma/migrations/` - DB schema (drift-checked in CI)
- `.env.example` - full env var reference with demo-fallback docs
