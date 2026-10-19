# 前端 V7 验收文档（可选收尾：遗留修复 + 网关/镜像语义复核）

- 日期：2026-10-19
- 阶段：前端替换 V7（承接 V6 收官；执行 V6 验收文档「遗留与后续」清单，主计划无 V7 章节，属可选收尾）
- 结论：**通过**（graph-ui 13/13 + theme-ui 38/38 + docs 三门禁 + 根 lint/test:unit + frontend 门禁）

## 1. 范围与改动

### 1.1 KbGraphView 边高亮缺陷修复（V6 遗留首项，Next 版同源问题）
- **缺陷**：组件以节点 id（`ent_*`）匹配边端点，而 `@shared/kg/layout` 输出端点是实体 **label**（API 形状；layout 单测注释「renderer resolves positions by label」即此契约）——匹配恒失败导致两个后果：边坐标 find 失败全部塌在 (0,0)；选中节点后邻接边永不变 primary 色。
- **修复**（[KbGraphView.vue](file:///Users/wsy/Project/KnowledgeAI/frontend/src/views/KbGraphView.vue)）：组件侧 computed 里 label→id 一次换算，统一到 id 空间寻址——模板坐标绑定、邻居集合、变暗逻辑零改动。label 必有对应节点由 layout 的 labelSet 端点过滤保证。**不动共享模块契约**（`@shared/kg/layout` 输出形状由根单测锁定）。
- **test-graph-ui.mjs**：① 恢复「邻接边 primary 高亮」断言；② 新增「边坐标锚定」断言（无全零线——节点坐标被 layout clamp 在 ≥30，全零线不可能合法出现）；③ 点击目标从 `g.node[0]`（可能无邻接边）改为按 mentions 降序换算 DOM 序的必有邻接边 hub 节点，断言确定性。**13/13**。

### 1.2 WCAG 高对比度覆盖规则移植（V6 遗留）
- **tokens.css** 补齐 `.high-contrast` / `.high-contrast.dark` / `@media (prefers-contrast: more)` 令牌块（tokens.css 为 V6 后唯一事实源）：同源移植自已退役的 globals.css，级联顺序语义保持 `.dark` → `.high-contrast` → `.high-contrast.dark` → `@media` 内 `:root`/`.dark`（后定义者胜）。EP 侧无需额外适配——element-adapter.css 的 EP 变量均以 `hsl(var(--x))` 动态解析本文件令牌。globals 版 `.text-*-500` 500 色阶修正为 Tailwind 类专用（Vue 无该类），不移植。
- **test-theme-ui.mjs** 恢复 8 项 WCAG 计算对比度断言（light/dark 各 4：正文/次要文字 ≥4.5:1、边界 ≥3:1、primary 按钮文字）。测量 JS 自包含（AA_JS）：锚点为 AppShell 稳定类 `.shell`（正文/底色）、`.ws-plan`（次要文字）、`.ws-btn`（边界），`--primary/--primary-foreground` 用临时 probe 元素经真实级联解析。**38/38**（原 30 + 恢复 8）。

### 1.3 网关与 Docker 镜像语义复核（V7 清单）
- **deploy/nginx.conf**：`location /` → Next 兜底**保留**——V6 后仍有两个真实职责：`/vendor/swagger-ui/*`（/docs 页引用）与 `/widget/*`（可嵌入挂件）等 Next `public/` 单源静态资产（PWA 资产虽已拷入 Vue dist 但网关无对应路由，同样经兜底可达）；未切页面路径由 Next 404。仅更新过时注释（「页面 + 静态资源 + PWA」→ 纯 API 兜底口径）。nginx -t 校验通过。
- **Dockerfile**：standalone-clean 剥离清单补齐 V6 后混入 standalone 输出的目录——`frontend/`(2.4M)/`services/`(1.5M)/`docs/`/`deliverables/`/`deploy/`/`playwright-report/` + `docker-compose.split*.yml`/`AGENTS.md`/`README.md`（黑名单随仓库演化腐烂的实测记录）。**验证**：本地模拟新剥离清单 + `node server.js` 冷启——`/api/health` 200、`/vendor/swagger-ui` 200、`/widget` 200。
- **docker-compose.split.yml**：头注「其余 → 前端(Next)」与 app 服务注释改为 V6 后口径（页面由 switch conf 承载，Next 纯 API + 单源静态兜底）。

### 1.4 frontend/e2e 并入 CI（V7 清单）
- **决策**：并入。31 用例（认证 9/工作台 7/知识库 4/聊天+Agent 6/管理端 5）与根 e2e（8 主流程）、smoke ui 组（9 脚本特性深检）互补，是 CI 中唯一超出主流程的 Vue 页面级覆盖；本地实测全量 ~4.6min（含双 webServer 冷启），在已有 chromium 的 e2e job 内增量可接受。
- **ci.yml e2e job**：根套件后追加 `pnpm --filter kai-frontend test:e2e`（其 webServer 自动拉起 Next dev :3000 抬高限流 + vite dev :5173；根 e2e 结束时已释放端口，无冲突）；报告 artifact 路径增加 `frontend/test-results/` 与 `frontend/playwright-report/`。yaml-lint 通过。
- AGENTS.md 两处 e2e 门禁描述同步（frontend 节「暂为本地门禁」→ 已入 CI；CI gate 第 5 job 步骤）。

### 1.5 docs 双前端描述清理（V7 清单）
- **deployment-guide.md**：revert-all 注记「V6 起 Next 已无页面层——仅回滚到 V5 之前代码时才成立」；验证节「未切页面仍返回 Next（HTML 含 /_next/）」→「未切页面路径由 Next 兜底 404」；「登录会话跨壳有效」措辞退役（单壳）。
- **service-split.md** 前端替换节：V1 进行时态 → V6 完成态（28/28 页面、Next 页面层已删除、验收文档 v1~v6 清单）。
- 顺手修 deployment-guide → faq 的 `#troubleshooting` 死锚点（faq.md 无该锚点，指向页面本身）。
- **AGENTS.md** 主题段更新为 V6/V7 后口径：预置脚本唯一实现在 `frontend/index.html`、HC 规则在 tokens.css、品牌色无 SSR 注入（客户端 applyBrandColor）、外观 tab 指向 ThemeSettings.vue。
- **design log** 十五·二十七追加 V7 落地段（本阶段全量记录）。

## 2. 门禁与测试结果

| 门禁 | 结果 |
| --- | --- |
| smoke graph-ui（修复验证） | ✅ **13/13**（恢复邻接边高亮 + 新增边坐标锚定） |
| smoke theme-ui（WCAG 恢复验证） | ✅ **38/38**（原 30 + 恢复 8 项 AA 断言） |
| frontend typecheck（vue-tsc） | ✅ |
| frontend lint / vitest | ✅（1 个 V5 遗留 warning：SettingsView.vue `router` unused，0 errors 不挡门禁，本次未触碰该文件） |
| frontend build + prerender | ✅ |
| docs:build / frontmatter 35 / env-parity 80 | ✅ 三门禁全绿 |
| 根 `pnpm lint` | ✅ |
| 根 `pnpm test:unit` | ✅（coverage 80.6%/67.1%，高于 70/60 门槛） |
| nginx -t（deploy/nginx.conf + switch conf） | ✅ |
| ci.yml yaml-lint | ✅ |
| standalone 剥离后 node server.js 冷启 | ✅（/api/health、/vendor、/widget 均 200） |

## 3. 实测发现

1. **standalone 输出腐烂**：Turbopack 复制整个项目源码的行为叠加 V6 期间新增的 frontend/services/docs 等目录，旧剥离清单漏了 8 项——黑名单需随仓库演化维护（已在 Dockerfile 注释注明运行时白名单语义）。
2. **frontend/e2e 长跑共享 dev server 下 agent 用例偶发超时**（SSE 契约 + 报告渲染，重试 1 次通过）：本地共享 dev server 长时间运行的环境抖动，CI 冷启（demo 模式 + 抬高限流）无此问题；`retries: 1` 已压掉。
3. settings 路径 `.ws-plan`/`.ws-btn`/`.shell` 在 1280×900 视口稳定渲染，可作 WCAG 断言锚点。

## 4. 遗留与后续

- **graph-rag demo 检索质量 2/20**：distractor baseline 偶不被骗（plain 直答对导致「graphRag>plain」提升断言失去前提）——demo 哈希嵌入对测试语料的敏感性漂移，非回归（src/lib 检索未动）。调语料/权重的波及面大（extract.ts 测试依赖精确模式），**明确后置**。
- **语音 STT/TTS 迁移**（V4 起后置的最大遗留）：`src/lib/voice/{stt,tts}.ts` + hooks 已随页面层删除，Vue 侧无 Web Speech 实现——工作量独立成阶段（语音输入按钮 + 读原文案 + i18n + e2e），宜另立 V8 或并入产品迭代。
- 回退：全部改动在 git 工作区未提交可整批 revert；V7 不含任何网关切流状态变更（routes.conf 27 条不变、switch conf 未重生成），`switch-frontend.sh` 语义不受影响。
