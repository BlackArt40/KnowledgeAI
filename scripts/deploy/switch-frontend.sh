#!/usr/bin/env bash
# ── 前端绞杀切流唯一入口（V1 起，Vue 3 重写）────────────────────────────────
# 从 deploy/nginx/routes.conf 生成 nginx switch 配置写入宿主机
# deploy/nginx/frontend-switch.conf（该文件以只读 bind mount 挂进网关容器，
# 写宿主文件即容器内生效），然后 nginx -t 校验 + reload。
# 回退 = 恢复上一版 routes.conf 再 apply（秒级、无状态）；全部回 Next = revert-all。
#
# 用法：
#   scripts/deploy/switch-frontend.sh list        # 查看当前已切换路由
#   scripts/deploy/switch-frontend.sh apply       # routes.conf → 网关（先备份到 routes.conf.bak）
#   scripts/deploy/switch-frontend.sh rollback    # 恢复 routes.conf.bak → apply
#   scripts/deploy/switch-frontend.sh revert-all  # 清空路由（全部流量回 Next）
#
# 前置条件（apply 前自检）：
#   - docker compose -f docker-compose.split.yml 的 gateway 在跑
#   - frontend/dist 已构建（pnpm -C frontend build），且包含 index.html
#
# 生产操作步骤见 docs/ops/deployment-guide.md「前端切流与回退」节（单一手册）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTES_FILE="$REPO_ROOT/deploy/nginx/routes.conf"
BACKUP_FILE="$REPO_ROOT/deploy/nginx/routes.conf.bak"
SWITCH_CONF="$REPO_ROOT/deploy/nginx/frontend-switch.conf"
ENV_FILE="$REPO_ROOT/${SPLIT_ENV_FILE:-deploy/.env.split}"

COMPOSE="docker compose -f $REPO_ROOT/docker-compose.split.yml"
[ -f "$ENV_FILE" ] && COMPOSE="$COMPOSE --env-file $ENV_FILE"

die() { echo "[switch-frontend] ERROR: $*" >&2; exit 1; }

compose_gateway_running() {
  $COMPOSE ps gateway 2>/dev/null | grep -q gateway
}

# routes.conf → nginx location 块配置（stdout）
generate_conf() {
  local rev
  rev="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo norev)"
  echo "# 由 scripts/deploy/switch-frontend.sh 生成（${rev}）—— 手改无效，切流唯一入口是本脚本"
  echo "# 源：deploy/nginx/routes.conf"
  echo ""
  echo "# Vue 静态资源（Vite 产物带 hash；^~ 前缀优先且不被后续正则改写）"
  cat <<'ASSETS'
location ^~ /assets/ {
    root /srv/vue;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
ASSETS
  echo ""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    # 去除全部空白后判空
    line="$(echo "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && continue
    case "$line" in
      "/")
        # 首页：优先返回构建期预渲染的 SEO 静态页（dist/home.html，国内搜索
        # 引擎不执行 JS）；产物缺失时回退 SPA index.html（客户端渲染兜底）
        echo "location = / {"
        echo "    root /srv/vue;"
        echo "    try_files /home.html /index.html =404;"
        echo "}"
        ;;
      *\*)
        # 以字面 * 结尾 = 前缀路由：/share-doc/* → location ^~ /share-doc/ {}
        # （动态段 [token] 由 SPA 路由消化）。注意不能用 /* 做模式——那会
        # 匹配所有以 / 开头的行（V1 演练实测踩坑）
        local base="${line%\*}"
        echo "location ^~ ${base%/}/ {"
        echo "    root /srv/vue;"
        echo "    try_files /index.html =404;"
        echo "}"
        ;;
      *)
        echo "location = $line {"
        echo "    root /srv/vue;"
        echo "    try_files /index.html =404;"
        echo "}"
        ;;
    esac
    echo ""
  done < "$ROUTES_FILE"
}
# try_files /index.html =404：fallback 是 root 下的【文件路径】而不是 URI——
# 若写成 "$uri /index.html"，/index.html 会作为 URI 重新过一遍 location 匹配，
# 落进 location / 被 proxy 到 Next（Next 无此文件 → 404），SPA 永远出不来。

cmd_list() {
  echo "[switch-frontend] 当前 routes.conf 声明的已切换路由："
  grep -v '^\s*#' "$ROUTES_FILE" | grep -v '^\s*$' || true
  echo "[switch-frontend] （空 = 全部流量走 Next）"
}

cmd_apply() {
  # 注意：变量后紧跟全角字符必须加花括号（macOS 自带 bash 3.2 会把多字节
  # 字节吞进变量名，报 unbound variable —— 5.5 演练曾因此失败）
  [ -f "${ENV_FILE}" ] || die "缺少 ${ENV_FILE} （cp deploy/env.split.example deploy/.env.split 并填 AUTH_SECRET）"
  [ -d "$REPO_ROOT/frontend/dist" ] || die "frontend/dist 不存在 —— 先执行 pnpm -C frontend build"
  [ -f "$REPO_ROOT/frontend/dist/index.html" ] || die "frontend/dist/index.html 不存在 —— 产物不完整，重新 pnpm -C frontend build"
  compose_gateway_running || die "gateway 容器未运行（docker compose -f docker-compose.split.yml up -d gateway）"

  # skip_backup=1 时跳过备份（revert-all 已在清空【前】备份，避免把空表覆盖进 bak）
  # 注意标志经 $1 传入（cmd_apply skip_backup），不是 $2
  if [ "${1:-}" != "skip_backup" ]; then
    cp "$ROUTES_FILE" "$BACKUP_FILE"
  fi

  local tmp
  tmp="$(mktemp)"
  generate_conf > "$tmp"

  echo "[switch-frontend] 生成 switch conf -> $SWITCH_CONF"
  cp "$tmp" "$SWITCH_CONF"
  rm -f "$tmp"

  # bind mount 只读：写宿主文件即容器内生效，nginx -t 直接校验新内容
  if ! $COMPOSE exec -T gateway nginx -t; then
    echo "[switch-frontend] nginx -t 失败：回写占位空 conf 并 reload，保证网关仍全部指向 Next"
    echo "# switch-frontend: invalid generation reverted to placeholder" > "$SWITCH_CONF"
    $COMPOSE exec -T gateway nginx -s reload
    die "生成的 switch conf 未通过 nginx -t（检查 deploy/nginx/routes.conf 语法）"
  fi
  $COMPOSE exec -T gateway nginx -s reload
  echo "[switch-frontend] 完成。当前切流路由："
  cmd_list
}

cmd_rollback() {
  [ -f "$BACKUP_FILE" ] || die "没有可回退的备份（$BACKUP_FILE 不存在）"
  cp "$BACKUP_FILE" "$ROUTES_FILE"
  echo "[switch-frontend] 已恢复上一版 routes.conf，重新 apply ..."
  cmd_apply
}

cmd_revert_all() {
  # 清空【前】先备份（V1 演练踩坑：先清空再 apply 会把空表覆盖进 bak，
  # rollback 从此只能恢复到空表）
  cp "$ROUTES_FILE" "$BACKUP_FILE"
  echo "# 已清空（switch-frontend.sh revert-all）——全部页面流量走 Next" > "$ROUTES_FILE"
  cmd_apply skip_backup
}

case "${1:-}" in
  list)       cmd_list ;;
  apply)      cmd_apply ;;
  rollback)   cmd_rollback ;;
  revert-all) cmd_revert_all ;;
  *)
    die "用法: $0 {list|apply|rollback|revert-all}"
    ;;
esac
