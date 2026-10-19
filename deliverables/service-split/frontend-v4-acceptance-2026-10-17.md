# 前端 V4 验收文档（Vue 3 绞杀重写 · 聊天 + Agent + 账务）

- 日期：2026-10-17
- 阶段：前端替换 V4（承接 V3；service-split.md 阶段 6「前端替换」）
- 结论：**通过**（门禁 + e2e 26/26 + i18n 4/4 + 根门禁 + 演练）

## 1. 范围（+5 路由，累计 23/28）

- **/chat**（ChatView + 3 个子组件）：SSE 流式对话（@shared/sse 消费，事件 `sources/token/done` 冻结，epoch 守卫 + AbortController 停止生成）；markdown + 引用 chips（`frontend/src/lib/markdown.ts`：markdown-it html:false + 渲染后 `[n]`→`<button data-cite>` 注入，`<pre>/<code>` 内不转换，容器 click 委托高亮来源面板）；反馈（点赞/点踩+备注，目标服务端 messageId，再次点击置 null 撤销）；regenerate（0.7 高温 + topK+3 服务端换参重试）；会话列表（搜索/新建/删除确认/归档切换/标签编辑 el-dialog/团队共享分组）；共享开关（PATCH shared）；联网搜索开关；图片附件（≤4 base64）；导出 MD；空态示例问（按 KB ready 文档推导，page.chat.s50-54 模板）；追问建议 chips；KB 推荐（2-gram overlap）；深链接 `?kb=&conv=`；移动端会话/来源 el-drawer；IME isComposing 防误发
- **/agent**（AgentView）：SSE 运行流（`init/step/done/error/end` 冻结；error code 本地化 queue_busy/queue_failed；settled 守卫覆盖流中断）；composer（主题默认值/KB 选择含 `public` 公开检索哨兵/输出格式三按钮/深度 slider 3-10/模板 chips 联动格式与 agent 组合/角色开关）；时间线（进度/结果预览）+ DAG 可视化（task.dagNodes 未就绪时按 steps/模板推导）；报告（markdown+引用 chip 点击高亮/复制/编辑 PUT report/分享/导出 md|pdf|pptx|mindmap，pdf window.open）；版本历史（diff 视图 @shared/agent/diff + confirm 恢复）；协作评论（按引用锚定/回复/删除）；历史任务侧栏 + 引用面板 + duration 页脚；深链接 `?task=`
- **/billing**（BillingView）：当前套餐卡（STATUS_LABEL 状态徽标/周期/席位/支付方式/cancelAtPeriodEnd）、恢复|升级|取消（POST /api/billing/cancel）、套餐对比表（PLANS+COMPARISON @shared/billing/plans 单源）、账单列表 + CSV 导出（\uFEFF BOM）
- **/checkout**（CheckoutView）：`?plan=` 深链接校验、订单摘要、支付方式三选（微信/支付宝/卡）、POST checkout → sleep 2600 → POST checkout/{id} 模拟支付、表单/处理中（二维码占位）/成功/免支付四态
- **/usage**（UsageView）：workspace 级四张用量卡（问答/API/存储/Agent，额度按套餐派生，>80% 警告徽标 + el-progress 变色）、每用户 QA 14 天趋势（UsageChart 复用）、el-skeleton 加载态 + 失败重试
- **接线**：AppShell 导航 /chat /agent /billing /usage 改 migrated（V1-V4 全量）+ titleMap 对齐 Next 九项 + 侧栏升级按钮改 router-link；GlobalSearch 迁移前缀扩至 9 条（/chat?kb=&conv=、/agent?task= 深链接走 router 内跳）；routes.conf 17→22 条

## 2. 明确后置（批准范围）

- 语音输入（STT）与回答朗读（TTS）——Next 版 P7-4 能力，V4 不做
- 移动端横滑切换会话（use-gestures 手势）——移动端走会话抽屉
- mermaid chip 流、代码块复制按钮（Next chat-markdown 增强项）

## 3. 门禁与测试

| 门禁 | 结果 |
| --- | --- |
| frontend 四门禁（vue-tsc / eslint / vitest / vite build） | ✅ |
| frontend/e2e（auth 9 + workbench 7 + kb 4 + **V4 新增 6**） | ✅ **26/26** |
| i18n 扫描 4/4（全量复用既有 page.chat/agent/billing/checkout/usage 键，零新增） | ✅ |
| 根仓 lint / test:unit（覆盖率 80.6%/67.1% 高于阈值） | ✅ 双轨零回归 |
| clean-machine-drill（22 路由，含 /chat 切流断言） | ✅ PASS=22 FAIL=0 |

**SSE 契约断言（新）**：`frontend/e2e/chat-agent.spec.ts` 用 `page.request` 读全响应体，断言 `/api/chat` 含 `"type":"sources"| "token" | "done"`、`/api/agent/run` 含 `"type":"init" | "step" | "done"`——把「SSE 事件名不变」从冻结约定升级为可执行测试。UI 流用例自建自清（KB/会话/任务 API 建删，顺序无关）。

## 4. 实测发现并修复

1. **EP 图标名不存在**：GitBranchMerge/Bankcard/ShieldCheck 不是 @element-plus/icons-vue 导出（lucide 同名直译陷阱）——vue-tsc 门禁拦下，改用 Document/CreditCard/CircleCheck；
2. **i18next-vue 解构名**：useTranslation() 返回 `{ t, i18next }`（不是 React 版的 i18n）——取语言用 `i18next.language`；
3. **全局 fetch 无泛型**：`fetch<T>()` 报 TS2558——json 后 as 断言（strict 下禁 any）；
4. **`<template v-for>` key 必须挂在 template 标签**（vue/no-v-for-template-key-on-child error）；
5. **v-html 豁免按文件白名单**：MessageBubble/AgentView 加入 eslint.config.mjs 既有 SharedReportView 豁免组（markdown-it html:false 净化，豁免有据）。

## 5. 遗留与后续

- V5：/admin 全部 + /developer + /docs（swagger-ui-dist 原样嵌入）+ 首页 `/`（构建期预渲染保 SEO）；
- V6：删 src/app 页面 + 客户端 hooks（保留 src/lib 与 /api），Next 退为纯 API + 八门禁改写；
- 回退开关：`scripts/deploy/switch-frontend.sh revert-all` 秒级全量回 Next；单页回退 = 删 routes.conf 对应行后 apply。
