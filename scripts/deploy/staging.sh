#!/usr/bin/env bash
# ===========================================================================
# Staging 部署脚本（P6-3）
#
# 在目标服务器上执行：
#   1. docker pull 新镜像（GHCR）
#   2. 拉起依赖（redis/postgres，幂等——已存在则无操作；首次部署自动创建）
#   3. 通过 docker compose 更新 app + worker（环境变量来自服务器 .env）
#   4. 等待 Docker 健康检查通过（Dockerfile 内置 wget HEALTHCHECK）
#
# 用法（由 .github/workflows/deploy.yml 通过 SSH 调用）:
#   staging.sh <image:tag> <compose-dir>
#
# 环境变量:
#   KAI_ENV_FILE    compose 的 env_file（默认 .env；本地开发可用 .env.local）
#   KAI_IMAGE       由脚本 export，供 compose 文件 ${KAI_IMAGE} 替换镜像
#
# 退出码: 0 = 部署成功；非 0 = 失败（workflow 标红，可回滚重跑）
# ===========================================================================
set -euo pipefail

IMAGE="${1:?usage: staging.sh <image:tag> <compose-dir>}"
COMPOSE_DIR="${2:-$PWD}"

echo "[staging] pulling ${IMAGE}"
docker pull "${IMAGE}"

echo "[staging] updating compose image reference"
cd "${COMPOSE_DIR}"
if [ -f docker-compose.staging.yml ]; then
  COMPOSE_FILE="docker-compose.staging.yml"
else
  COMPOSE_FILE="docker-compose.yml"
fi
export KAI_IMAGE="${IMAGE}"
export KAI_ENV_FILE="${KAI_ENV_FILE:-.env}"

# 依赖服务（redis/postgres）幂等拉起：首次部署自动创建，后续无操作。
# app/worker 用 --no-deps 避免更新时误动依赖。
echo "[staging] ensuring dependencies (redis, postgres)"
docker compose -f "${COMPOSE_FILE}" up -d --pull never redis postgres

echo "[staging] bringing up app + worker"
docker compose -f "${COMPOSE_FILE}" up -d --no-deps --pull never app worker

echo "[staging] waiting for health checks..."
HEALTHY=0
for i in $(seq 1 30); do
  STATUS="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$(docker compose -f "${COMPOSE_FILE}" ps -q app)" 2>/dev/null || echo none)"
  if [ "${STATUS}" = "healthy" ]; then
    HEALTHY=1
    break
  fi
  echo "[staging] app health: ${STATUS} (${i}/30)"
  sleep 5
done

if [ "${HEALTHY}" != "1" ]; then
  echo "[staging] ❌ app did not become healthy - deployment failed (rolling back image is possible: docker compose up -d with the previous tag)" >&2
  exit 1
fi

echo "[staging] ✅ app healthy, worker updated"
docker compose -f "${COMPOSE_FILE}" ps
echo "[staging] done"
