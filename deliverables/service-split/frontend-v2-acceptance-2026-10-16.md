# 前端 V2 验收文档（Vue 3 绞杀重写 · 工作台骨架：AppShell + /dashboard + /settings + Cmd+K）

- 日期：2026-10-16
- 阶段：前端替换 V2（承接 V1；service-split.md 阶段 6「前端替换」）
- 结论：**通过**（门禁 + e2e 16/16 + 演练）

## 1. 范围

- **AppShell**（frontend/src/components/AppShell.vue）：桌面侧栏 + 移动端抽屉（el-drawer）+ 顶栏（页标题/搜索触发/通知铃铛/语言切换/主题切换/用户菜单）。导航 11 项与 Next 版逐字一致（路径/角色/i18n key），**已接管路由（/dashboard /settings）用 router-link，未迁移项用 `<a>` 整页跳转回 Next**（跨壳纪律）。
- **工作区切换器**：GET/POST /api/workspaces + kai-workspace cookie（7 天）+ 整页刷新；品牌色 owner-only（PATCH /api/workspaces）。
- **通知**：30s 轮询 GET /api/notifications?limit=10、全部已读 POST、单条 PATCH；未读角标 + 安全告警红色样式。
- **/dashboard**：5 API 并发（auth/me、knowledge-base、usage、chat/conversations?limit=5、agent/tasks）→ 4 统计卡 + 用量趋势（纯 SVG 面积图）+ Agent 任务进度（角色可见）+ 最近问答（深链接 /chat?conv=&kb=）。
- **/settings 全 5 tab**（?tab= 与 URL 双向同步，深链接契约保持）：security（2FA enroll/verify/disable 真流程 + OAuth 绑定/解绑 + 会话管理 + 登录历史）、profile（资料/密码/语言持久化/通知偏好）、privacy（三开关 + 保留期 + 导出 + DELETE 确认删号）、models（列表/启停/测试/删除/新增，apiKey 掩码）、appearance（主题三模式 + 高对比度 + 品牌色，共享主题引擎直驱）。
- **Cmd+K 全局搜索**（GlobalSearch.vue）：GET /api/search 五类实体、tab 过滤、250ms 防抖 + abort、↑↓/Enter/Esc 键盘导航、最近搜索（kai-recent-search，8 条去重）；跳转遵守跨壳纪律。
- **路由**：meta.shell 由 App.vue 挂 AppShell；routes.conf 增 /dashboard /settings（网关切流）。

## 2. 门禁与测试

| 门禁 | 结果 |
| --- | --- |
| frontend 四门禁（vue-tsc / eslint / vitest 6 / vite build） | ✅ |
| frontend/e2e（auth 9 + workbench 7） | ✅ **16/16** |
| i18n 扫描（含 frontend/src） | ✅ 4/4 |
| 根仓 tsc / lint / test:unit / docs:build | ✅（双轨零回归） |
| clean-machine-drill（routes.conf 13 路由） | ✅ PASS=21 FAIL=0（V1 口径；V2 增路由后复跑见 §4） |

## 3. e2e 实测发现并修复

1. **登录 429**：套件 ~9 次登录撞匿名限流（默认 20/min）——webServer 启动 Next dev 注入 `RATE_LIMIT_ANON_PER_MIN=1000` 等（与 CI integration 同口径）；
2. **EP tabs DOM**：全部 pane 都渲染（非当前项 aria-hidden）——断言改 `#pane-${tab}` 可见性 + 激活项中文标签；
3. **隐藏按钮误点**：移动端搜索按钮 sm:hidden —— 断言改 aria-label 定位；
4. **dev server 负载抖动**：playwright retries=1 + expect 15s。

## 4. 演练

routes.conf 增 /dashboard /settings 后复跑 clean-machine-drill（结果记录于 PR 描述）：切流 apply → /login、/dashboard 均出 Vue 首帧 → revert-all → 全回 Next → rollback 恢复，全链路绿。

## 5. 遗留与后续

- 侧栏未迁移项仍整页跳 Next（V3 知识库、V4 聊天/Agent 逐批接管后改 router-link）；
- presence SSE 已具备消费位（use-sse 可经 @shared/sse 复用），V3 团队页接入 UI；
- e2e 2 workers 并行（两个 spec 文件）依赖 reuseExistingServer 复用已限流的 dev server——CI 集成 frontend/e2e 时需保证 env 注入顺序；
- V3：/knowledge-base 列表/上传/详情/图谱（d3-force）+ /team + /api-keys。
