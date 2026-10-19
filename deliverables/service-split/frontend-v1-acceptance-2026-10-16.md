# 前端 V1 验收文档（Vue 3 绞杀重写 · 认证/静态/分享 11 路由 + 网关切流）

- 日期：2026-10-16
- 阶段：前端替换 V1（承接 design log 十五·二十七；service-split.md 阶段 6「前端替换」增补节）
- 结论：**通过**（本地门禁 + e2e + i18n 扫描全绿；网关切流/回退演练见 §6）

## 1. 范围

用户决策（2026-10-16）：前端从 Next.js 更改为 Vue 3 + Element Plus + Vite；绞杀式按模块渐进（硬约束：每阶段保留回退开关）；最终态全功能对等；单仓 `frontend/` 目录。

V1 交付 = ① 11 个路由的 Vue 实现；② 网关绞杀切流机制（routes.conf + switch 脚本）；③ Vue 侧测试与扫描门禁；④ 文档与 runbook。

## 2. 迁移路由（11）

| 组 | 路由 | 说明 |
| --- | --- | --- |
| (auth) | /login /register /verify-email /forgot-password /reset-password /2fa-enroll | AuthLayout 分屏壳；2FA 三态登录（直接登录 / requires2FA / mustEnroll2FA→sessionStorage 预授权） |
| 静态 | /privacy /terms /maintenance | 全文案走 page.* i18n key（单源，零新增 key） |
| 分享 | /share-doc/[token] /r/[id] | 公开访问；错误码 needPassword/expired/exhausted/notFound（doc）与 needPassword/expired/exhausted/disabled（report）逐一对齐 |

契约冻结核验：/api/auth/*（login 三态、register needsVerification、verify-email/resend、forgot demoResetUrl、reset 死链语义、2fa-enroll enroll/verify 双 action）、/api/share/doc/[token]（query 传密码）、/api/agent/public/[id]（x-share-password 头）、/api/auth/providers + oauth-signin（CSRF POST 流程经 @shared 直接复用）。

## 3. 关键实现

- 共享资产单源复用：i18next-vue 绑定 `src/lib/i18n/translate.ts` 共享单例（同语言包同插值）；`@shared` 引用 `theme/{mode,brand-colors}.ts`、`oauth-signin.ts`、`format.ts`（其内部 import 改相对路径以保持可移植）。
- 401 豁免清单（`frontend/src/api/client.ts`）：/api/auth/（登录页自管错误）、/api/share/、/api/agent/public/（分享令牌/密码即凭据，401=密码错误）。
- EP 暗色对齐：`html.dark` 与 kai-theme 同构；`element-adapter.css` 映射 EP 变量到 HSL 令牌（color-mix 派生梯度），品牌色 `applyBrandColor` 自动传导。
- 跨壳导航：/dashboard、/（官网）在 V2/V5 前仍属 Next，用整页跳转（`window.location`/`<a>`），Vue router 只管已接管路由。

## 4. 网关绞杀切流

- `deploy/nginx.conf`：server 级 `include /etc/nginx/frontend-switch.conf`（精确/`^~` location 优先级高于 `location /` 兜底）。
- `deploy/nginx/routes.conf`：已迁移路径单一事实源（11 条，`/share-doc/*`、`/r/*` 为前缀段）。
- `scripts/deploy/switch-frontend.sh`：list / apply（备份 routes.conf.bak → 生成 conf → nginx -t → reload，失败自动回写占位）/ rollback / revert-all。
- `docker-compose.split.yml`：网关挂载 switch conf（占位已提交，生成后随切流提交留审计轨迹）与 `./frontend/dist:/srv/vue:ro`。
- Runbook（单一手册）：`docs/ops/deployment-guide.md`「前端切流与回退」节。

## 5. 门禁与测试结果（本机 node v22 / docker 29.8.0）

| 门禁 | 结果 |
| --- | --- |
| `pnpm -C frontend typecheck`（vue-tsc） | ✅ |
| `pnpm -C frontend lint`（eslint flat + vue） | ✅ 0 错 0 警 |
| `pnpm -C frontend test`（vitest） | ✅ 6/6 |
| `pnpm -C frontend build`（vite） | ✅ |
| `frontend/e2e`（Playwright，双 webServer） | ✅ 9/9（登录三态/已登录回跳/注册→verify-email/忘记密码 demo 链接/reset 死链态/share-doc 失效态/报告分享错误态/静态页三连） |
| `scripts/smoke/test-i18n-coverage.ts`（扩扫 frontend/src） | ✅ 4/4 |
| 根仓 `npx tsc --noEmit` / `pnpm lint` / `pnpm test:unit`（覆盖率 80.6%≥70） | ✅ 全绿（双轨护栏：Next 侧门禁零回归） |
| env parity / docs:build | ✅（VITE_API_BASE 双侧同步） |

## 6. 网关切流/回退演练

`scripts/deploy/clean-machine-drill.sh` 新增 2.5 段（起栈前构建 dist——**栈启动后 vite 清空重建目录会使 macOS Docker bind mount 目录视图失同步，实测踩坑**）与 5.5 段：apply → 断言 /login 返回 Vue 首帧（`id="app"` + `/assets/`）→ revert-all → 断言回 Next → rollback 恢复路由表与 conf 一致。

**最终演练（本机 docker 29.8.0，干净库，business×2）：PASS=21 FAIL=0，A6.1 通过 ✅**（含网关冒烟 8 项 + 切流演练 6 项）。

演练过程中实测暴露并修复 5 个真实缺陷（均已落进脚本与文档）：
1. **compose 插值不自足**：app/worker 的 `env_file: ${SPLIT_ENV_FILE:-deploy/.env.split}` 在无 `.env.split` 的机器上让 compose config 加载即报错（up/exec/ps 全挂）——drill 现在向 .env.drill 注入 `SPLIT_ENV_FILE=deploy/.env.drill`；
2. **bash case 模式误匹配**：`/*)` 会匹配所有以 `/` 开头的行，精确路由全被生成为前缀 location（`/login` 不带尾斜杠落回 Next）——改为 `*\*`（以字面 `*` 结尾）；
3. **try_files 回退是 URI 而非文件**：`try_files $uri /index.html` 的最后参数作为 URI 重新过 location 匹配，落进 `location /` 被 proxy 到 Next——改为 `try_files /index.html =404`（root 下真实文件）；
4. **macOS bash 3.2 多字节吞名**：`$ENV_FILE（` 变量后紧跟全角括号报 unbound variable——变量一律加花括号；
5. **revert-all 摧毁备份**：先清空 routes.conf 再 apply，备份步骤把空表覆盖进 bak（且 skip_backup 标志误传 `$2` 实为 `$1`）——revert-all 清空【前】先备份，rollback 可精确恢复；演练结束以 rollback 恢复路由表，废弃 /tmp 拷贝链。

## 7. 遗留与后续

- CI `frontend` job 已加（typecheck→lint→vitest→build）；`frontend/e2e` 暂为本地门禁（双 dev server 成本），V2 评估入 CI。
- GitHub 侧 branch protection 需补加 `frontend` required check（同 smoke/smoke-infra 先例，仓库侧无法配置）。
- `frontend/src/styles/tokens.css` 与 `src/app/globals.css` 令牌块、`frontend/index.html` 预置脚本与 `layout.tsx` themeScript 为双端同步义务（V6 退役后收敛为单源）。
- V2：工作台骨架（/dashboard + AppShell + /settings 全 tab）+ Cmd+K + EP DOM 版 smoke ui 选择器同步。
