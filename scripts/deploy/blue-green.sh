#!/usr/bin/env bash
# ===========================================================================
# 蓝绿部署脚本（P6-3，生产）
#
# 容器级蓝绿：新版本先在备用端口启动并通过健康检查，通过后接管 :3000
# （停旧启新 + 端口接管）；健康检查失败则自动回滚（删除新容器，旧版本不受影响）。
#
# 用法:
#   blue-green.sh <image:tag> [app-name] [port] [env-file]
#     app-name  容器名前缀（默认 kai-app）
#     port      对外端口（默认 3000）
#     env-file  传给容器的环境文件（默认 .env）
#
# 退出码: 0 = 切换成功；1 = 新版本未通过健康检查（已回滚，旧版本仍在服务）
# ===========================================================================
set -euo pipefail

IMAGE="${1:?usage: blue-green.sh <image:tag> [app-name] [port] [env-file]}"
NAME="${2:-kai-app}"
PORT="${3:-3000}"
ENV_FILE="${4:-.env}"

BLUE="${NAME}-blue"    # 新版本（健康检查通过后接管）
GREEN="${NAME}-green"  # 当前对外服务
ALT_PORT=$((PORT + 1)) # 备用端口（健康检查用）
HEALTH_URL="http://127.0.0.1:${ALT_PORT}/"
TIMEOUT_S=60

cleanup() {
  echo "[blue-green] cleaning up new container ${BLUE}"
  docker rm -f "${BLUE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[blue-green] pulling ${IMAGE}"
docker pull "${IMAGE}"

echo "[blue-green] starting ${BLUE} on :${ALT_PORT} for health checks"
docker rm -f "${BLUE}" >/dev/null 2>&1 || true
docker run -d \
  --name "${BLUE}" \
  --env-file "${ENV_FILE}" \
  -p "${ALT_PORT}:3000" \
  --health-cmd "wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1" \
  --health-interval 5s \
  --health-timeout 3s \
  --health-retries 3 \
  --health-start-period 10s \
  "${IMAGE}" >/dev/null

echo "[blue-green] waiting up to ${TIMEOUT_S}s for health..."
HEALTHY=0
for i in $(seq 1 $((TIMEOUT_S / 3))); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' "${BLUE}" 2>/dev/null || echo missing)"
  if [ "${STATUS}" = "healthy" ]; then
    HEALTHY=1
    break
  fi
  if [ "${STATUS}" = "unhealthy" ]; then
    break
  fi
  sleep 3
done

if [ "${HEALTHY}" != "1" ]; then
  echo "[blue-green] ❌ new version not healthy (status=${STATUS}) - rolling back, ${GREEN} keeps serving" >&2
  exit 1
fi

echo "[blue-green] ✅ new version healthy - promoting"
docker inspect "${GREEN}" >/dev/null 2>&1 && docker rm -f "${GREEN}" >/dev/null 2>&1 || true
docker rename "${BLUE}" "${GREEN}"

# 接管对外端口：以最终名称重启，映射回主端口
docker rm -f "${GREEN}" >/dev/null 2>&1 || true
docker run -d \
  --name "${GREEN}" \
  --env-file "${ENV_FILE}" \
  -p "${PORT}:3000" \
  "${IMAGE}" >/dev/null

echo "[blue-green] ✅ ${GREEN} now serving on :${PORT}"
trap - EXIT
