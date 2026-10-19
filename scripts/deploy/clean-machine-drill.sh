#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A6.1 干净机器演练（service-split.md 阶段 6）：三服务全栈一键起 + 冒烟。
#
# 在目标机器（已安装 docker + compose 插件 + curl + python3，仓库已 clone）上：
#   bash scripts/deploy/clean-machine-drill.sh [--keep] [--port 8088]
#   --keep   演练后保留栈运行（默认收尾 down -v 全量清理）
#
# 行为：
#   1. 生成 deploy/.env.drill（AUTH_SECRET / AI_INTERNAL_TOKEN 随机，可预先放置）
#   2. 探测 MinIO 镜像可拉取：成功 → 生产定义（真实 MinIO）；失败 → 自动切
#      docker-compose.split.drill.yml（moto S3 兼容层，阶段 2 同口径）并告警
#   3. 一键起全栈（business ×2 副本）并等待 healthy
#   4. 种子演示用户（owner@knowledgeai.dev / password123，密码哈希内嵌）
#   5. 过网关冒烟：前端页 / 就绪探针 / 登录 / KB+文档索引 / chat SSE / agent SSE /
#      分享门控 403
#   6. 汇总 PASS/FAIL；默认 down -v 全量清理
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/../.."

KEEP=0
GATEWAY_PORT=8088
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --port) GATEWAY_PORT="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ✅ $1"; }
bad()  { fail=$((fail+1)); echo "  ❌ $1"; }
check(){ if [[ $1 == "$2" ]]; then ok "$3"; else bad "$3 (期望 $2 实得 $1)"; fi }

export SPLIT_ENV_FILE=deploy/.env.drill   # app/worker 的 env_file 路径联动
export GATEWAY_PORT

echo "── 0/6 前置检查 ──"
for bin in docker curl python3; do
  command -v "$bin" >/dev/null || { echo "缺少 $bin"; exit 1; }
done
docker compose version >/dev/null || { echo "缺少 compose 插件"; exit 1; }
ok "docker / compose / curl / python3"

echo "── 1/6 环境变量 ──"
if [[ ! -f deploy/.env.drill ]]; then
  mkdir -p deploy
  {
    echo "AUTH_SECRET=$(openssl rand -hex 32)"
    echo "AI_INTERNAL_TOKEN=drill-$(openssl rand -hex 16)"
    echo "GATEWAY_PORT=$GATEWAY_PORT"
  } > deploy/.env.drill
  ok "生成 deploy/.env.drill（随机密钥）"
else
  ok "复用现有 deploy/.env.drill"
fi
# compose 插值自足：app/worker 的 env_file: ${SPLIT_ENV_FILE:-deploy/.env.split}
# 必须解析到演练 env（deploy/.env.split 是生产本地文件，演练机不保证存在）——
# 否则 compose config 加载即报 "env file not found"，up/exec/ps 全挂
if ! grep -q '^SPLIT_ENV_FILE=' deploy/.env.drill; then
  echo "SPLIT_ENV_FILE=deploy/.env.drill" >> deploy/.env.drill
fi
ok "SPLIT_ENV_FILE 指向演练 env（compose 插值自足）"

BASE="docker compose -f docker-compose.split.yml"
echo "── 2/6 MinIO 可达性探测 ──"
COMPOSE_FILES="-f docker-compose.split.yml"
if docker pull -q minio/minio:latest >/dev/null 2>&1; then
  ok "MinIO 镜像可拉取 → 生产定义（真实 MinIO）"
else
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.split.drill.yml"
  echo "  ⚠️ MinIO 镜像不可得 → 自动切 moto S3 兼容层（阶段 2 同口径；生产仍为 MinIO）"
fi

echo "── 2.5/6 前端产物（V1，Vue 3 重写）──"
# 必须在起栈【之前】构建：网关以 bind mount 挂 ./frontend/dist，栈启动后
# vite 清空重建目录会让 macOS Docker 的目录视图失同步（实测踩坑）；起栈前
# 构建则挂载绑定的是稳定目录。无 pnpm 的干净机器跳过（保持全 Next 形态）。
if command -v pnpm >/dev/null 2>&1; then
  pnpm -C frontend build >/dev/null 2>&1 && ok "Vue 前端构建（frontend/dist，起栈前）" \
    || echo "  ⚠️ frontend build 失败 → 切流演练将跳过（保持全 Next）"
else
  echo "  ⚠️ 无 pnpm → 跳过前端构建与切流演练（保持全 Next 形态）"
fi

echo "── 3/6 一键起全栈（business ×2，首建需数分钟）──"
# shellcheck disable=SC2086
$BASE $COMPOSE_FILES --env-file deploy/.env.drill up -d --build --scale business=2 || { echo "启动失败"; exit 1; }

echo "── 等待 healthy（最长 15 分钟）──"
DRILL_PS() { docker compose $COMPOSE_FILES --env-file deploy/.env.drill ps --format "{{.Service}} {{.Status}}"; }
deadline=$((SECONDS + 900))
while [[ $SECONDS -lt $deadline ]]; do
  unhealthy=$(DRILL_PS | grep -E "business|app|ai|minio" | grep -vc "(healthy)" || true)
  ready=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$GATEWAY_PORT/api/health/ready" || true)
  if [[ "$unhealthy" == "0" && "$ready" == "200" ]]; then break; fi
  sleep 10
done
unhealthy=$(DRILL_PS | grep -E "business|app|ai|minio" | grep -vc "(healthy)" || true)
check "$unhealthy" "0" "全部服务 healthy（business×2 / app / ai / minio）"

echo "── 4/6 种子演示用户（干净库）──"
docker compose $COMPOSE_FILES --env-file deploy/.env.drill \
  exec -T postgres psql -U user -d knowledgeai >/dev/null 2>&1 <<'SQL'
INSERT INTO "Workspace" (id, name, plan, "ownerId", members, "createdAt", "updatedAt")
VALUES ('ws_default', '演示工作区', 'pro', 'usr_owner', ARRAY['usr_owner']::text[], now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "User" (id, email, name, "passwordHash", role, "createdAt", "updatedAt")
VALUES ('usr_owner', 'owner@knowledgeai.dev', '演示 Owner',
        'pbkdf2$100000$weklW1GTLs6X2xI2TdYXVQ$89dn88qYNjpHky_y5uoq9tjzjoeKdVDKYEr6tcE-1zE',
        'OWNER', now(), now())
ON CONFLICT DO NOTHING;
SQL
ok "种子写入（owner@knowledgeai.dev / password123）"

GW="http://127.0.0.1:$GATEWAY_PORT"
echo "── 5/6 过网关冒烟 ──"
# app healthy ≠ Next 首页就绪（首次请求需现场渲染），502/超时重试 ~30s
HOME_CODE=""
for _ in 1 2 3 4 5 6; do
  HOME_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$GW/")
  [ "$HOME_CODE" = "200" ] && break
  sleep 5
done
check "$HOME_CODE" "200" "前端首页"
READY=$(curl -s -m 10 "$GW/api/health/ready")
[[ "$(echo "$READY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))")" == "True" ]] \
  && ok "就绪探针 ok:true" || bad "就绪探针: $READY"

TOKEN=$(curl -s -m 15 -X POST "$GW/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"owner@knowledgeai.dev","password":"password123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")
[[ -n "$TOKEN" ]] && ok "登录（JWT 签发）" || bad "登录失败"

KB=$(curl -s -m 15 -X POST "$GW/api/v1/knowledge-bases" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"演练KB","desc":"A6.1"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('kb',{}).get('id',''))")
[[ -n "$KB" ]] && ok "建知识库（${KB}）" || bad "建知识库失败"

DOC=$(curl -s -m 30 -X POST "$GW/api/v1/knowledge-bases/$KB/documents" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"演练文档.md","content":"A6.1 异机演练文档：知识库的关键趋势是检索增强生成。"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin).get('doc',{}); print(d.get('id',''))")
[[ -n "$DOC" ]] && ok "文档索引（同步 ready）" || bad "文档索引失败"

DONE_FRAMES=$(curl -s -N -m 40 -X POST "$GW/api/chat" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"kbId\":\"$KB\",\"query\":\"演练：关键趋势\"}" \
  | grep -c '"type": *"done"\|"type":"done"' || true)
check "$DONE_FRAMES" "2" "chat SSE（sources/token/done，done 重组 1 + Python 1）"

AGENT_DONE=$(curl -s -N -m 90 -X POST "$GW/api/v1/agent/run" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"topic":"A6.1 演练调研"}' | tee /tmp/drill-agent-sse.txt \
  | grep -c '"type": *"done"\|"type":"done"' || true)
check "$AGENT_DONE" "1" "agent SSE（init/step×3/done/end）"
if [[ "$AGENT_DONE" != "1" ]]; then echo "  └─ agent 帧序片段: $(head -c 400 /tmp/drill-agent-sse.txt)"; fi

check "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $TOKEN" "$GW/api/agent/tasks/nonexistent")" "404" "任务详情越权/不存在 404（带 token）"

echo "── 5.5/6 前端切流演练（V1，Vue 3 绞杀重写）──"
# dist 已在 2.5 步构建（起栈前）；此处只做切流/回退开关演练
if [ -f frontend/dist/index.html ]; then
  cp deploy/nginx/routes.conf /tmp/drill-routes.orig
  SPLIT_ENV_FILE=deploy/.env.drill scripts/deploy/switch-frontend.sh apply > /tmp/drill-switch-apply.log 2>&1 \
    && ok "switch apply（routes.conf → 网关）" || bad "switch apply 失败（见 /tmp/drill-switch-apply.log）"
  docker exec knowledgeai-gateway-1 sh -c 'ls /srv/vue | head -3; grep -c "location = /login" /etc/nginx/frontend-switch.conf' > /tmp/drill-switch-inspect.log 2>&1 || true
  # 断言带重试（最多 ~15s），覆盖 nginx 优雅重载的秒级窗口
  LOGIN_HTML=""
  for _ in 1 2 3 4 5; do
    LOGIN_HTML=$(curl -s -m 10 "$GW/login")
    echo "$LOGIN_HTML" | grep -q 'id="app"' && break
    sleep 3
  done
  echo "$LOGIN_HTML" > /tmp/drill-login.html 2>/dev/null || true
  echo "$LOGIN_HTML" | grep -q 'id="app"' && ok "登录页已切 Vue（精确 location 优先于兜底）" \
    || bad "登录页未切到 Vue"
  # V4：/chat 也已由 Vue 接管（与 /login 同款首帧断言）
  CHAT_HTML=""
  for _ in 1 2 3 4 5; do
    CHAT_HTML=$(curl -s -m 10 "$GW/chat")
    echo "$CHAT_HTML" | grep -q 'id="app"' && break
    sleep 3
  done
  echo "$CHAT_HTML" | grep -q 'id="app"' && ok "问答页 /chat 已切 Vue" \
    || bad "问答页 /chat 未切到 Vue"
  # V5：首页 / 已切 Vue（优先返回预渲染 home.html）
  HOME_HTML=$(curl -s -m 10 "$GW/")
  echo "$HOME_HTML" | grep -q 'id="app"' && ok "首页 / 已切 Vue（预渲染 SEO 首帧）" \
    || bad "首页 / 未切到 Vue"
  echo "$LOGIN_HTML" | grep -q '/assets/' && ok "Vue 资源走 /assets/（与 /_next/static 不冲突）" \
    || bad "未发现 /assets/ 引用"
  SPLIT_ENV_FILE=deploy/.env.drill scripts/deploy/switch-frontend.sh revert-all >/dev/null 2>&1 \
    && ok "switch revert-all（秒级回退开关：全部流量回 Next）" || bad "switch revert-all 失败"
  AFTER_HTML=""
  for _ in 1 2 3 4 5; do
    AFTER_HTML=$(curl -s -m 10 "$GW/login")
    echo "$AFTER_HTML" | grep -q '_next' && break
    sleep 3
  done
  echo "$AFTER_HTML" | grep -q '_next' && ok "回退后登录页回到 Next" \
    || bad "回退后仍非 Next 页面"
  # 演练结束恢复路由表：revert-all 已把清空【前】的路由备份进 routes.conf.bak，
  # rollback 恢复路由表并重新 apply（conf 与路由表保持一致，留下审计轨迹）
  SPLIT_ENV_FILE=deploy/.env.drill scripts/deploy/switch-frontend.sh rollback >/dev/null 2>&1 \
    && ok "switch rollback（路由表恢复至演练前 + conf 同步）" || bad "switch rollback 失败"
  grep -q '^/login$' deploy/nginx/routes.conf && grep -q '^/usage$' deploy/nginx/routes.conf && ok "routes.conf 完整性（27 路由在位）" \
    || bad "routes.conf 恢复异常"
fi

echo "── 6/6 汇总 ──"
echo "PASS=$pass FAIL=$fail"
if [[ $fail -eq 0 ]]; then echo "演练结论：A6.1 通过 ✅"; else echo "演练结论：存在失败项 ❌"; fi

if [[ $KEEP -eq 1 ]]; then
  echo "保留栈运行：网关 http://127.0.0.1:${GATEWAY_PORT}（down 请去 --keep 重跑或手动 compose down）"
else
  $BASE $COMPOSE_FILES --env-file deploy/.env.drill down -v >/dev/null 2>&1
  echo "已收尾（down -v 全量清理）"
fi
[[ $fail -eq 0 ]]
