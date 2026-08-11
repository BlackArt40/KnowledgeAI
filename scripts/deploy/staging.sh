#!/usr/bin/env bash
# ===========================================================================
# Staging 部署脚本（P6-3）
#
# 在目标服务器上执行：
#   1. docker pull 新镜像（GHCR）
#   2. 通过 docker compose 拉起 app + worker（环境变量来自服务器 .env）
#   3. 等待 Docker 健康检查通过（Dockerfile 内置 wget HEALTHCHECK）
#
# 用法（由 .github/workflows/deploy.yml 通过 SSH 调用）:
#   staging.sh <image:tag> <compose-dir>
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
