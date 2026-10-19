# 前端 V5 验收文档（Vue 3 绞杀重写 · 管理端 + 门户 + 首页）

- 日期：2026-10-17
- 阶段：前端替换 V5（承接 V4；service-split.md 阶段 6「前端替换」最后一批页面）
- 结论：**通过**（门禁 + e2e 31/31 + i18n 4/4 + 根门禁 + docs:build + 演练）

## 1. 范围（+5 路由，累计 **28/28 全量接管**）

- **/admin**（AdminView，owner/admin）：八张统计卡（用户/活跃/收入/KB/问答/Agent/存储/文档）、收入柱状趋势、用户列表（搜索过滤 + 封禁/解封 PATCH status）、系统配置卡（默认/嵌入模型、上传限制、注册开关、维护模式、2FA 角色矩阵——开关即 PATCH、其余保存提交）、KB 监控表、速率限制看板（memory/redis 徽标 + 四档限额 + 活跃维度实时表 + 手动刷新）、Provider 状态面板、安全审计（链完整性徽标 + action/actor 过滤 + 总量）。类型单源 @shared/admin/types；rate-limit/provider/audit 为服务端模块——api/admin.ts 内声明同构 JSON 镜像类型
- **/admin/monitoring**（MonitoringView）：请求 SLI 四卡（每分钟请求数/总量/错误率/p50 延迟）、QPS 分钟级曲线（UsageChart 复用）、队列快照表（waiting/active/delayed/completed/failed）、LLM 用量与成本按模型表（含合计行）、RAG/文档/Agent 三卡、追踪列表（点击展开拉取 span 树，kind 徽标着色）、错误环
- **/developer**（DeveloperView + IntegrationsPanel）：四 tab——快速开始（JS/Python/Go SDK 示例 + /docs 外链）、Webhook 管理（创建对话框 name/url/secret/三事件复选、启停、测试、删除、投递记录表 dead/error 状态徽标）、用量统计（总量/订阅/平均延迟/最近调用四卡 + 24h 按小时分桶调用图 + 端点分布表）、集成市场（Widget 嵌入片段生成与复制、群机器人一次性 token 展示/启停/删除、Chrome 扩展、n8n/Zapier 文档、Notion/Confluence 同步表单与结果计数）
- **/docs**（DocsView，独立无壳页）：顶栏（品牌 + API 文档徽标 + 开发者门户链接）+ Swagger UI 渲染 /api/openapi.json。swagger-ui-dist 资产**单源在 Next public/vendor**（postinstall 拷贝）：开发走 vite proxy `^/vendor/`，生产走网关 `location /` 兜底命中 Next 静态目录——不拷贝不重复打包
- **首页 /**（HomeView + 4 个营销组件）：Navbar（登录态区分「进入工作台」vs「登录/免费开始」+ 移动端菜单）、Hero（网格/锥形渐变背景、主标题、双 CTA、信任点、**KnowledgeConsole** 四场景脚本化演示台——仪表盘数字滚动/知识库逐个就绪/问答流式打字/Agent 步进，进视口自动播放一次、可重播、prefers-reduced-motion 直达终态、纯展示无 API）、LiveStatus（30s 轮询 /api/health/ready，@shared/marketing/readiness 单源）、Features、Workflow、Pricing（@shared/billing/plans）、CTA、Footer。同页锚点用原生 `<a>`（router hash 记账叠加问题与 Next 同源）
- **首页 SEO 预渲染**：`pnpm -C frontend build` 末步 Vite SSR 构建（仅 HomeView 最小应用：pinia + i18next + EP ID/ZINDEX 注入）+ @vue/server-renderer 产出 **dist/home.html**（36KB 静态中文首页）；switch-frontend.sh 对 "/" 行特判 `try_files /home.html /index.html =404`——产物缺失自动回退 SPA。国内搜索引擎不执行 JS，静态首帧是硬需求
- **接线**：AppShell 导航 /admin /developer 改 migrated + **补齐 Next 版已有的 /admin/monitoring 导航项**（page.app-shell.s27）+ titleMap 补 /developer；routes.conf 22→27 条（/admin、/admin/*、/developer、/docs、/）

## 2. 门禁与测试

| 门禁 | 结果 |
| --- | --- |
| frontend 四门禁（vue-tsc / eslint / vitest / vite build **含预渲染**） | ✅ |
| frontend/e2e（auth 9 + workbench 7 + kb 4 + V4 6 + **V5 新增 5**） | ✅ **31/31** |
| i18n 扫描 4/4（全量复用既有键，零新增） | ✅ |
| 根仓 lint / test:unit（覆盖率 80.6%/67.1% 高于阈值） | ✅ 双轨零回归 |
| docs:build（design log V5 段新增） | ✅ |
| clean-machine-drill（27 路由，含 `/` 预渲染首帧 + /chat 切流断言） | ✅ PASS=23 FAIL=0 |

## 3. 实测发现并修复

1. **SFC script 块按裸文本解析**：widget 片段字符串里的 `<script>` 标签需写成 `<\/script>`，**注释里**的字面闭合标签同样会终止块（模板全部丢失 setup 绑定，vue-tsc 报一片 Cannot find name）——注释措辞也要规避；
2. **SSR 预渲染三坑**：① 必须继承主 vite.config.ts（configFile:false 丢 alias/vue 插件）；② SSR bundle 外部化 vue/i18next 裸导入，产物必须放 node_modules 树内（node_modules/.kai-prerender）才能被 Node 解析链找到；③ EP 组件 SSR 需提供 ID_INJECTION_KEY/ZINDEX_INJECTION_KEY，ThemeToggle 的 pinia store 需注册实例；
3. **EP tabs 所有 pane 常驻 DOM**（V2 已知）：developer 四 tab 均渲染——`.snippet` 全局计数 5（quickstart 3 + integrations 2），断言必须限定 #pane-quickstart；
4. lucide→EP 图标直译陷阱（V4 已见）在 MonitoringView 再次出现（TrendCharts 未用清理）。

## 4. 遗留与后续

- **V6 退役**：删 src/app 页面 + src/components + 客户端 hooks（保留 src/lib 与 /api），Next 退为纯 API；八门禁改写（playwright webServer 改 vite preview + Next API；quality tsc 双包；vitest coverage 目录收缩说明）；PWA 注册迁移与 sw.js 预缓存清单重写；
- 回退开关：`scripts/deploy/switch-frontend.sh revert-all` 秒级全量回 Next；单页回退 = 删 routes.conf 对应行后 apply（"/" 行删除后首页回 Next 服务端渲染，SEO 不受影响）。
