---
title: 运维 Runbook
description: KnowledgeAI 事故处置手册：服务无法可靠关闭、数据库备份恢复、队列积压处置的判定步骤、验收标准与回滚
type: how-to
category: ops
level: L2
version: 1.0.0
authors: [devops-owner]
owner: devops-owner
reviewed_at: 2026-09-30
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [deployment-guide.md, monitoring.md, env-vars.md]
---

# 运维 Runbook

本手册记录**已有可独立复现的触发条件、判定步骤、验收标准和回滚动作**的运维流程。
每条目都遵循同一结构：症状 → 判定 → 处置 → 验收 → 回滚。

> 术语与约定见 [监控与告警](monitoring.md)。所有"网络可达性"结论都必须用
> `curl --noproxy '*'` 或 `nc -z` 取得——经由代理的 `curl` 可能返回伪造的 502，
> 不能作为服务健康状况的证据。

---

## RB-01 服务已关闭，但页面仍可访问

**来源**：2026-09-30 事故复盘（`deliverables/engineering-assurance/incident-login-page-after-shutdown-2026-09-30.md`）。
这是本仓库的第一条 Runbook 条目。

### 症状

在宿主机上已经"关闭服务"，但 `http://localhost:3000/`（或对应域名）仍能打开登录页，
甚至"看起来还能登录"。

### 判定（按顺序执行，任一步命中即止）

```bash
# 1. 端口上是否真有监听？（ps 在受限环境会被拒绝，改用 lsof / pgrep）
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3100 -sTCP:LISTEN

# 2. 是否残留进程（孤儿化的 next-server 子进程）
pgrep -fl 'next-server|pnpm start|next start'

# 3. 网络层是否真的不可达（必须绕过代理）
curl --noproxy '*' -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
nc -z -w 3 127.0.0.1 3000 && echo "端口开放" || echo "端口关闭"
```

| 观察结果 | 结论 |
|----------|------|
| 端口仍监听 / `pgrep` 有输出 | **残留进程**：关闭动作没有传递到子进程（进程树未回收） |
| 端口已关闭但页面仍能打开 | **Service Worker 离线兜底**：浏览器端用预缓存的 app shell 顶替了页面 |
| 两者同时存在 | 两条通道叠加——这正是 2026-09-30 的事故形态 |
| `curl` 返回 502 | **不要采信**：经代理的 502 是伪造的，换 `--noproxy '*'` 重测 |

浏览器侧确认（服务端无法观测）：

1. 在**原本的浏览器 profile**中打开 DevTools → Application → Service Workers；
2. 若显示 `activated`，即命中了 SW 离线兜底（无痕窗口没有 SW，恒通过，不能用于验证）；
3. Cache Storage 中若有 `p5-1-*-shell`，即存在可被离线使用的页面外壳。

> 注意：`/api/*` 是 network-only，**真·离线登录不可能成功**。所谓"能登录"通常是
> "登录页能打开"或"已有会话直接呈现已登录态"。不要据此判定为入侵或数据泄露。

### 处置

1. **回收进程**（不要硬编码 PID）：

   ```bash
   pkill -TERM -f 'next-server|pnpm start|next start'
   sleep 3
   pgrep -fl 'next-server|pnpm start' && pkill -KILL -f 'next-server|pnpm start'
   ```

2. **注销客户端 Service Worker**（用户侧，非破坏性）：DevTools → Application →
   Service Workers → Unregister；随后 Clear storage（Cache Storage + localStorage + cookie）。
   硬刷新（Cmd+Shift+R）后页面应**无法访问**。

3. **远程批量注销**（E3 kill switch，面向已安装 SW 的全体客户端）：把
   `public/sw-config.json` 的 `disabled` 置为 `true` 并部署。SW 在下次 `activate`
   时读到该配置会清空全部缓存并 `self.registration.unregister()`。
   连续重载两次即可生效（SW 首次导航后才 activate）。

### 验收

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # 应为空
pgrep -fl 'next-server|pnpm start' # 应无输出
curl --noproxy '*' http://127.0.0.1:3000/   # 应连接被拒（rc=7）
```

浏览器侧：Application → Service Workers 显示 `unregistered`；Cache Storage 为空；
硬刷新后页面不可访问。

### 回滚 / 恢复

把 `public/sw-config.json` 改回 `{"disabled": false}` 并重新部署即可恢复离线能力；
已注销的客户端会在下次访问时重新注册 SW。

### 预防（已落地）

- SW 预缓存**只含未鉴权路由**（`/`、`/login`、manifest、图标）；已鉴权页面不再
  预缓存，也不会被离线提供给未登录浏览器（E4）。
- 导航失败返回**显式离线页（HTTP 503）**，不再静默回退缓存页面，避免"关掉了却
  看起来还活着"（E4）。
- 登录页在 `navigator.onLine === false` 时禁用提交并给出提示，消除"能填不能登"（E4）。
- CI 的 `smoke-infra` job 末尾新增 teardown step，回收脚本自建的 `next start`
  实例，并在残留时让 job 失败（E5）。

---

## RB-02 数据库备份与恢复（发布前必做）

### 症状 / 触发

任何包含 Prisma 迁移的发布；或需要把数据回退到某个时点。

### 判定

```bash
npx prisma migrate status        # 当前已应用的迁移版本
```

### 处置

```bash
# 1. 发布前全量备份（回滚点）
pg_dump "$DATABASE_URL" -Fc -f "backup-$(date +%F-%H%M).dump"

# 2. 登记回滚点：镜像 tag + 迁移版本 + 备份路径（见部署前检查报告 B0-6）

# 3. 迁移先于应用新版执行，且必须向下兼容（老代码能读新 schema）
npx prisma migrate deploy
```

### 验收

- 备份文件存在且非空；`pg_restore --list <file>` 可列出内容。
- `prisma migrate status` 显示 "Database schema is up to date"。

### 回滚（优先级从高到低）

1. **前向修复**：写一个新迁移抵消问题（Prisma 无自动 down 迁移）；
2. **快照恢复**：`pg_restore` 从发布前备份恢复；
3. `prisma migrate resolve` + 已评审的手工 down SQL。

> **若已执行破坏性迁移**（如 `20260816100000_drop_dead_tables`），**禁止直接回滚
> 镜像**——老代码可能引用已删除的表。只能前向修复或快照恢复。

---

## RB-03 队列积压 / 内存持续攀升

### 症状

`/admin/monitoring` 中队列深度单调上升；或容器 RSS 持续攀升直至 `OOMKilled`。

### 判定

```bash
curl -s http://127.0.0.1:3000/api/health/ready | jq '{status, degraded, rateLimitDegraded}'
curl -s http://127.0.0.1:3000/api/health | jq .          # liveness 应恒 200
```

- worker 是否在运行（app 只写队列不消费）：

  ```bash
  docker inspect --format '{{.State.Running}}' <worker-container>
  ```
- `rateLimitDegraded: true` 说明限流已回落单实例内存桶（Redis 不可用）；
- 队列深度单调上升 + worker 正常 → 消费能力不足或某类任务卡住。

### 处置

1. 先恢复 worker（第 16 项部署后检查：`KAI_WORKER_IMAGE` 起 worker）；
2. Redis 不可用时优先恢复 Redis：**限流会静默回落到单实例内存桶**，多副本部署下
   各实例独立计数，实际限额被放大；
3. 内存无界增长时临时提高 `limits.memory` 或降低 `QUEUE_*_CONCURRENCY`，并保留现场
   用于定位（当前队列**无深度上限**，是已知债务）。

### 验收

`/api/health/ready` 返回 200 且 `degraded` 为空、`rateLimitDegraded === false`；
队列深度在数个窗口内回到基线且不再单调上升。

### 已知局限

队列**缺少深度/内存背压告警**（部署前检查报告 X5/X6），当前只能人工巡检。
