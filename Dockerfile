# ── 阶段 1：依赖安装 ──
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# postinstall (node scripts/tools/copy-swagger-ui.mjs) runs during install
COPY scripts/tools/copy-swagger-ui.mjs ./scripts/tools/copy-swagger-ui.mjs
RUN pnpm install --frozen-lockfile

# ── 阶段 2：构建 ──
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Re-run the postinstall copy: `COPY . .` replaces ./public with the local
# tree, which may lack the gitignored public/vendor/swagger-ui/ output.
RUN node scripts/tools/copy-swagger-ui.mjs
# Generate the Prisma client before build - `next build` type-checks imports of
# @prisma/client and CI runs `npx prisma generate` explicitly for the same reason.
RUN npx prisma generate
RUN pnpm build
# Bundle the worker entrypoint into a standalone worker.js that resolves the
# @/ path alias via tsconfig and marks bullmq/ioredis/prisma as external
# (they are provided by the standalone node_modules at runtime).
RUN pnpm exec esbuild worker.ts --bundle --platform=node --format=cjs \
    --outfile=worker.js \
    --alias:@=./src \
    --external:bullmq --external:ioredis --external:@prisma/client \
    --external:@aws-sdk/client-s3 --external:@aws-sdk/s3-request-presigner
# Next 16 (Turbopack) standalone 输出会把整个项目源码一并复制（框架行为）。
# 生成一个只含运行时文件的干净副本，runner 从它 COPY——直接把源码层带进
# 镜像的话，后续 RUN rm 无法释放分层空间（镜像会大几百 MB）。
RUN cp -a /app/.next/standalone /app/standalone-clean && \
    rm -rf /app/standalone-clean/src /app/standalone-clean/tests /app/standalone-clean/e2e \
    /app/standalone-clean/sdk /app/standalone-clean/integrations /app/standalone-clean/k8s \
    /app/standalone-clean/scripts /app/standalone-clean/Dockerfile /app/standalone-clean/docker-compose.yml \
    /app/standalone-clean/worker.ts /app/standalone-clean/next.config.ts \
    /app/standalone-clean/tsconfig.json /app/standalone-clean/tsconfig.tsbuildinfo \
    /app/standalone-clean/eslint.config.mjs /app/standalone-clean/postcss.config.mjs \
    /app/standalone-clean/vitest.config.ts /app/standalone-clean/playwright.config.ts \
    /app/standalone-clean/pnpm-lock.yaml /app/standalone-clean/pnpm-workspace.yaml

# ── 阶段 3：运行（极简镜像） ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# libc6-compat: glibc shims required by some bundled native modules on alpine.
RUN apk add --no-cache libc6-compat && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    # Upload dir: an empty named volume inherits this directory's owner on
    # first mount, so the non-root nextjs user can write uploads in compose
    # / k8s / blue-green deployments (EACCES otherwise).
    mkdir -p /app/.uploads && chown nextjs:nodejs /app/.uploads

COPY --from=builder /app/public ./public
# 干净副本：只含运行时文件（见 builder 阶段 standalone-clean 说明）
COPY --from=builder --chown=nextjs:nodejs /app/standalone-clean ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The bundled worker.js lives at the repo root so its CWD matches server.js.
COPY --from=builder --chown=nextjs:nodejs /app/worker.js ./worker.js

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# P6-4: liveness probe - /api/health answers 200 while the process is alive
# (dependency connectivity is /api/health/ready, not part of container liveness).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
