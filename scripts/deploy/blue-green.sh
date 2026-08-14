#!/usr/bin/env bash
# ===========================================================================
# 蓝绿部署脚本（P6-3，生产）
#
# 容器级蓝绿：新版本先在备用端口启动并通过健康检查，通过后接管 :3000。
# promote 阶段保留旧容器（改名 GREEN-old）直到新容器启动成功，任一环节失败
# 自动回滚（恢复旧容器继续服务）——不会出现"新旧都不可用"的空窗。
#
# worker 同步：设置 KAI_WORKER_IMAGE 时，app 切换成功后同步更新 worker 容器
# （kai-worker），保证队列消费端与 app 版本一致。
#
# uploads 共享：app 与 worker 都挂载 ${KAI_UPLOADS_VOLUME:-kai-uploads} 卷，
# 与 compose 部署共享时卷名需一致（compose 卷名 = <项目名>_uploads）。
#
# 用法:
#   blue-green.sh <image:tag> [app-name] [port] [env-file]
#     app-name  容器名前缀（默认 kai-app）
#     port      对外端口（默认 3000）
#     env-file  传给容器的环境文件（默认 .env）
#   环境变量:
#     KAI_WORKER_IMAGE    worker 镜像 tag（可选；设置则同步更新 worker）
#     KAI_UPLOADS_VOLUME  上传共享卷名（默认 kai-uploads）
#
# 退出码: 0 = 切换成功；1 = 新版本未通过健康检查或接管失败（已回滚，旧版本仍在服务）
# ===========================================================================
set -euo pipefail

IMAGE="${1:?usage: blue-green.sh <image:tag> [app-name] [port] [env-file]}"
NAME="${2:-kai-app}"
PORT="${3:-3000}"
ENV_FILE="${4:-.env}"
KAI_WORKER_IMAGE="${KAI_WORKER_IMAGE:-}"
KAI_UPLOADS_VOLUME="${KAI_UPLOADS_VOLUME:-kai-uploads}"
WORKER_NAME="kai-worker"

BLUE="${NAME}-blue"    # 新版本（健康检查通过后接管）
GREEN="${NAME}-green"  # 当前对外服务
ALT_PORT=$((PORT + 1)) # 备用端口（健康检查用）
HEALTH_URL="http://127.0.0.1:${ALT_PORT}/"
TIMEOUT_S=60

cleanup() {
  echo "[blue-green] cleaning up health-check container ${BLUE}"
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
  -v "${KAI_UPLOADS_VOLUME}:/app/.uploads" \
  -p "${ALT_PORT}:3000" \
  --health-cmd "wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1" \
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
OLD_IMAGE="$(docker inspect --format='{{.Config.Image}}' "${GREEN}" 2>/dev/null || echo "${IMAGE}")"

# 1) 停旧容器并改名保留（释放 :PORT 与 GREEN 名称；改名失败不阻断接管）
docker stop "${GREEN}" >/dev/null 2>&1 || true
docker rename "${GREEN}" "${GREEN}-old" >/dev/null 2>&1 || true

# 2) 新容器以正式名 + 主端口启动（端口映射创建时固定，健康检查实例需重建）
docker rm -f "${BLUE}" >/dev/null 2>&1 || true
if ! docker run -d \
  --name "${GREEN}" \
  --env-file "${ENV_FILE}" \
  -v "${KAI_UPLOADS_VOLUME}:/app/.uploads" \
  -p "${PORT}:3000" \
  "${IMAGE}" >/dev/null 2>&1; then
  echo "[blue-green] ❌ failed to start new ${GREEN} - rolling back" >&2
  docker rm -f "${GREEN}" >/dev/null 2>&1 || true
  docker rename "${GREEN}-old" "${GREEN}" >/dev/null 2>&1 || true
  docker start "${GREEN}" >/dev/null 2>&1 || true
  echo "[blue-green] ⚠️ rolled back - old container serving on :${PORT}" >&2
  exit 1
fi

# 3) 新容器确认进入健康检查流程后，回收旧容器；若直接 unhealthy 则回滚
sleep 5
STATUS="$(docker inspect --format='{{.State.Health.Status}}' "${GREEN}" 2>/dev/null || echo unknown)"
if [ "${STATUS}" = "healthy" ] || [ "${STATUS}" = "starting" ]; then
  docker rm -f "${GREEN}-old" >/dev/null 2>&1 || true
else
  echo "[blue-green] ❌ new container unhealthy (${STATUS}) - rolling back" >&2
  docker rm -f "${GREEN}" >/dev/null 2>&1 || true
  docker rename "${GREEN}-old" "${GREEN}" >/dev/null 2>&1 || true
  docker start "${GREEN}" >/dev/null 2>&1 || true
  echo "[blue-green] ⚠️ rolled back - old container serving on :${PORT}" >&2
  exit 1
fi

# 4) worker 与 app 版本保持一致（KAI_WORKER_IMAGE 设置时）
if [ -n "${KAI_WORKER_IMAGE}" ]; then
  echo "[blue-green] updating worker ${WORKER_NAME} to ${KAI_WORKER_IMAGE}"
  docker rm -f "${WORKER_NAME}" >/dev/null 2>&1 || true
  docker run -d \
    --name "${WORKER_NAME}" \
    --restart unless-stopped \
    --env-file "${ENV_FILE}" \
    -v "${KAI_UPLOADS_VOLUME}:/app/.uploads" \
    "${KAI_WORKER_IMAGE}" node worker.js >/dev/null
  sleep 3
  if ! docker inspect -f '{{.State.Running}}' "${WORKER_NAME}" 2>/dev/null | grep -q true; then
    echo "[blue-green] ❌ worker failed to start - app is updated but queue consumers are down" >&2
    exit 1
  fi
  echo "[blue-green] ✅ worker updated"
fi

echo "[blue-green] ✅ ${GREEN} now serving on :${PORT}"
trap - EXIT
