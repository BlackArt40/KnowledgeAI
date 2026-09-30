# 事故复盘：服务关闭后登录页仍可访问

**日期**：2026-09-30
**工作流**：工作流 3（事故响应 / 复盘）
**参与成员**：Rex（SRE 工程师）；Docu（技术文档师，复盘文档清晰度审校）
**事故载体**：本机 `http://localhost:3000/`（Intel Mac / macOS 14.8.9，KAI 生产构建实例）
**上报原话**：「在这台主机上，我已经关闭服务了，但是在 http://localhost:3000/ ，有一段时间还是可以去登录页面登录。」

> **落库提示**：本文件位于 `deliverables/`，不受 `docs/standards/*` 的 frontmatter 强制约束。若后续按"预防措施 5"迁入 `docs/ops/runbook.md`，需补齐必填 frontmatter（title/description/type/category/level/version/authors/owner/reviewed_at/review_interval/status）并补术语表词条（见文末）。

---

## 🔤 术语速览（面向非工程读者）

| 术语 | 白话释义 |
|------|---------|
| **Service Worker（SW）** | 浏览器端的"离线缓存小程序"，能在服务器不可达时用本地缓存顶替返回页面 |
| **孤儿进程（orphaned process）** | 父进程被终止后仍在后台继续运行的子进程 |
| **app shell** | 应用的"外壳页面"（HTML/JS/CSS 骨架），不含数据 |
| **network-first** | 请求策略：先试服务器，失败才用缓存 |
| **fail-open** | 失败时"默认放行/仍提供服务"（本事件中表现为断服仍返回页面），与 fail-closed（失败即拒绝）相反 |
| **kill switch** | 远程"总开关"，可让已装到用户浏览器里的 SW 自行卸载 |
| **origin** | 网站来源标识（协议+域名+端口），如 `http://localhost:3000` |
| **PWA** | 渐进式 Web 应用，可安装、可离线，本例即由此引入 SW |

---

## 📌 TL;DR（执行摘要）

- 整体结论：**服务"没关干净"（残留 `next-server` 孤儿进程）+ PWA Service Worker 离线兜底（预缓存的 `/login` 外壳在服务器不可达时静默返回）**叠加所致；现象是"服务还在"的假象，**非入侵、非数据泄露**。
- 严重度分布：**SEV4（低影响）** —— 单机 localhost、无外部用户、无数据损坏、无越权访问证据、可本机自愈。
- 阻塞 / 非阻塞：**非阻塞**。属"失效控制 / 加固"缺口，非活跃安全事件。
- 关键澄清：真·离线登录**不可能成功**（`/api/*` 与 POST 均不被 SW 接管），"能登录"最可能是"登录页能打开"或"已有会话直接呈现已登录态"。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🟡 **已可控**（现象已消失，根因明确，修复成本低） |
| 阻塞项数量 | 0 |
| 关键行动项 | 5 条（E1–E5，见行动清单） |
| 建议下一步 | 清 SW/缓存 + 结束残留进程；再给 `sw.js` 加远程 kill switch 与离线显式失败页，消除"关不掉"的系统性缺口 |

---

## 🕒 事故时间线（证据来源标注）

| 时点 | 事件 | 证据来源 |
|------|------|---------|
| T0 | 用户"关闭服务"（动作/命令/精确时刻**未知**，推断为前台 `Ctrl+C` 或关闭终端窗口） | 【假设·待用户补】 |
| T0 → T1 | **窗口期**：`:3000` 登录页仍可打开。两条通道并存：①**呈现页面**——Service Worker 离线缓存兜底（`sw.js:17-38` 预缓存 `/login`；`:78-89` navigate 失败回退 `caches.match`）；②**关闭未生效**——残留 `next-server` 仍存活/曾服务 | ①【实测·代码】 ②【实测·进程】 |
| T1 → 现在 | **网络层已不可达**：`lsof -nP -iTCP:3000 -sTCP:LISTEN` 与 `:3100` **均为空**；`curl --noproxy '*' http://127.0.0.1:3000/` → `curl: (7) Failed to connect ... Couldn't connect`（rc=7） | 【实测】 |

> **证据缺口**：T0/T1 具体时刻、窗口期内是否真有监听、用户端浏览器当前 SW 状态（服务端无法观测）。

### ⚠️ 关于残留进程端口的说明（**不影响根因结论**）
> 本节仅解释"残余进程监听在哪个端口"，**不改变上面的主/次根因判定**，可跳过而不影响阅读。
残留进程的启动参数是 `pnpm start -p 3100`，而用户访问的是 **`:3000`**。
- 【假设】`-p 3100` 未被 pnpm 转发给 `next start`，`next` 回落默认 `PORT=3000` → 残留进程实为服务 `:3000`（与用户 URL 吻合）。
- 【假设】或该机器历史上存在多个实例。
- 验证方式：**下次复现时**在残留进程存活时执行 `lsof -nP -p <PID> -a -iTCP`（本轮复测时残留进程已无任何 TCP fd）。

---

## 🎯 影响范围

| 维度 | 评估 |
|------|------|
| 受影响对象 | 仅本机 `localhost:3000` 的浏览器会话；无外部用户、无生产流量 |
| 功能影响 | 无功能受损；产生"服务仍在运行"的**误判**（若据此做发布/排障决策会被误导） |
| 数据影响 | **无**。`/api/*` 明确 network-only（`sw.js:71`）→ 无租户/用户数据经 SW 缓存泄露；缓存的仅页面外壳 |
| 安全影响 | 未见越权访问证据；属"失效控制"缺口（详见后文） |
| 持续时间 | "一段时间"后自行消失【假设】——更像残留进程最终退出/监听丢失，而非 SW（SW 缓存不会自愈消失） |

---

## 🚦 SEV 评级

**SEV4（低影响）**

| 级别 | 定义 | 本次是否命中 |
|------|------|-------------|
| SEV1 | 服务宕机/核心链路全断，全部用户 | ✗ |
| SEV2 | 主要功能降级 | ✗ |
| SEV3 | 次要功能/单团队/可绕过 | ✗（除非按安全口径重评，见下） |
| **SEV4** | **低影响/外观/单用户** | **✓ 命中** |

判据：影响面 = 单主机 localhost、无外部用户、无数据损坏/丢失、无非授权访问证据、可本机自愈（清缓存/杀进程）。

**升级条件（若命中则重评）**
- 若该机为**共享/受管环境**，或把 SW 的"离线兜底 + 无法远程注销"认定为安全控制缺口 → 升 **SEV3（安全类）**；
- 若该实例对外提供服务且"关闭不可靠"导致无法快速止损 → 升 **SEV2/3**。

---

## 🔎 根因分析（5 Why）

**主 / 次判定**
- **主因（解释"页面仍可呈现"）= Service Worker 离线兜底**。理由：只有它能在 origin 完全不可用时仍返回页面，与"能打开登录页"直接吻合。【实测·代码】
- **次因（解释"关服务为何没立刻生效/时间窗"）= 残留 `next-server` 进程未退出**。关闭只终止了前台/父进程，子进程被孤儿化继续运行（PID 至今存活）。【实测·进程 + 推断·机制】
- 二者**非互斥**，可叠加。

| # | Why | 结论 | 等级 |
|---|-----|------|------|
| W1 | 为何关服务后仍能访问登录页？ | 浏览器端仍能拿到页面（SW 缓存 和/或 残留进程仍在服务） | 【推断】 |
| W2a | 为何浏览器能离线拿到页面？ | SW 预缓存 app shell，navigate 失败回退缓存（`sw.js:17-38, 78-89`） | 【实测·代码】 |
| W2b | 为何"关服务"没停干净？ | 关闭未传递到 `next-server` 子进程，进程孤儿化继续运行 | 【实测·进程存活 + 推断·机制】 |
| W3 | 为何断服时 SW 静默兜底而不显式失败？ | navigate catch 直接回退 `caches.match`，无"离线"提示页（`sw.js:82-86`） | 【实测·代码】 |
| W4 | 为何没有机制阻止"服务关闭后仍提供内容"？ | 全仓无 `unregister`/kill switch；`VERSION` bump 仅删旧 `p5-1-*` 缓存、**不禁用 SW**（`sw.js:40-53`） | 【实测·grep】 |
| W5 | 为何存在该系统性缺口？ | 缺进程治理（无 pm2/systemd，CI 残留未清理）+ PWA 缺失效策略（无远程 kill switch、无离线显式失败） | 【推断】 |

### 「能登录」疑点澄清【实测·代码链】
真·离线登录**不可能成功**：`sw.js:66` 仅处理 GET（POST 不被接管）→ `sw.js:71` `/api/` network-only → `login/page.tsx:63-68` 的 `fetch("/api/auth/login", {POST})` 在服务停时网络失败 → 进 catch（`:88-90`）显示错误文案。故按可能性排序：
1. **② 用户把"打开登录页"说成"登录"**（页面能打开 = SW 缓存；提交必失败）——最可能【推断】；
2. **① 已有会话导致直接呈现已登录态**：登录成功会写 `localStorage["kai-token"]`（`page.tsx:84-87`）并设 httpOnly cookie，客户端壳可能据此直接渲染，无需再打服务器【可能】；
3. ③ 另有隐藏机制——未发现【实测·grep 无 unregister / 无额外 SW】。

---

## 🔐 是否构成安全 / 失效控制问题

**结论：是 —— 属"失效控制 / 加固"问题，但非活跃安全事件。**

| 维度 | 判定 | 证据 |
|------|------|------|
| 服务不可被可靠关闭 | **成立（双通道）**：①进程树残留（软关闭不保证杀死子进程）；②SW 内容兜底（origin 消失仍供页面） | 【实测】 |
| 内容 fail-open | **成立**：navigate 失败静默回退缓存，无显式离线失败页 | 【实测·代码】`sw.js:82-86` |
| 无法远程注销 SW | **成立**：全仓无 `navigator.serviceWorker.unregister` / kill switch；`VERSION` bump 只删旧缓存，新 SW 仍装 shell 并 `skipWaiting()+clients.claim()` 立即接管 | 【实测·grep】`sw.js:36,51` |
| stale SW 风险 | 安全更新后旧 SW 仍可能先供旧 shell（navigate 命中旧缓存；`/_next/static` 为 stale-while-revalidate 会先回旧 chunk） | 【实测·代码】`sw.js:92-100` |
| 数据层是否 fail-open | **否（关键缓解点）**：缓存的仅页面外壳，`/api/*` 明确不缓存 → 无租户/用户数据经 SW 泄露 | 【实测·代码】`sw.js:71` |

**建议定级：安全加固项 P2（若为共享环境则 P1）。**

---

## 🧪 通用探测前置（重要，复现任何网络/进程结论前必读）

- **沙箱 curl 陷阱**：本机沙箱代理会让**任何未加 `--noproxy` 的 `curl` 返回伪造的 502**（对死端口 `39999`、对真实端口结果完全一致）→ **"502"绝不能当作服务 5xx 的证据**。真实探测必须 `curl --noproxy '*' <url>` 且绕过沙箱（`dangerouslyDisableSandbox`）。
- **连通性交叉验证**：`nc -z -w 3 127.0.0.1 3000` 或 `node -e 'require("net").connect({host:"127.0.0.1",port:3000})...'`。
- **进程/端口**：`ps` 被 OS 拒绝（`operation not permitted`）→ 改用 `pgrep -fl` 与 `lsof -nP -iTCP:<port> -sTCP:LISTEN`。

---

## ✅ 行动清单

> 与 Rex 原始产出 E1–E7 的对应：原 E6（登录页离线提示）已并入 **E4**；原 E7（CI 残留清理）= **E5**。故编号统一为 E1–E5。

| # | 行动 | 负责角色 | 紧急度 |
|---|------|---------|--------|
| E1 | **清除客户端 SW 与缓存（用户侧，非破坏）**：DevTools → Application → Service Workers → **Unregister**；再 Clear storage（Cache Storage + localStorage + cookie）。<br>**前置**：先执行 E2（或确认 `:3000`/`:3100` 已无监听），否则服务仍可达、验收必失败。<br>**验收（在原本的 profile 中做，不能用无痕窗口——无痕窗口本就没有 SW/缓存，恒通过、无法验证效果）**：① Application → Service Workers 显示 `unregistered`；② Cache Storage 为空；③ 硬刷新（Cmd+Shift+R）→ 页面**无法访问** | 用户 / owner | **P0** |
| E2 | **进程治理**：动态结束残留进程（**不要硬编码 PID**）：`pkill -TERM -f 'next-server\|pnpm start'`（或先 `pgrep -f 'next-server\|pnpm start'` 取 PID 后 `kill -TERM <PID>`），等 2–3s，仍在则 `-KILL`。<br>**验收**：`lsof -nP -iTCP:3000 -sTCP:LISTEN` 与 `:3100` 均为空、`pgrep -fl "next-server\|pnpm start"` 无输出。<br>**根因治理**：用 pm2/systemd 管理，确保 stop 杀整棵进程树 | owner | **P0** |
| E3 | **SW 远程 kill switch**：**定一种实现**——推荐**运行时版本端点**（如 `/api/sw-config` 返回 `{disabled:true}`）：`activate` 时若禁用则清空全部缓存并 `self.registration.unregister()`。<br>**验收**：发布禁用版 → 连续**重载两次**（SW 首次导航后才 activate）→ Application 中 SW 变 `unregistered`、Cache Storage 清空 | 前端 owner | P1 |
| E4 | **收窄预缓存面 + 离线显式失败**：`APP_SHELL` 移除 `/dashboard`、`/chat`、`/agent` 等已鉴权路由（`sw.js:20-22`），仅留未鉴权壳；navigate 失败改为返回专用"服务不可用/离线"页而非静默兜底；登录页在 `navigator.onLine === false` 时禁用提交并提示。<br>**验收**：明确"离线"定义（**二选一**：DevTools → Network → Offline，或直接停服）→ 访问 `/dashboard` 应出现"离线"提示页，而非缓存成功 | 前端 owner | P1 |
| E5 | **CI 残留清理**：在 `ci.yml` 的 **`smoke-infra` job 末尾新增 teardown step**，回收脚本自建的 `next start` 实例。**验收**：CI 结束后 `pgrep -f next-server` 为空 | CI owner | P2 |

---

## 🛡️ 预防措施

1. **进程生命周期治理**：所有长驻服务纳入进程管理器（pm2/systemd），`stop` 必须回收整棵进程树；CI 自建实例加 teardown 断言。
2. **PWA 失效策略**：为 Service Worker 增加"远程 kill switch + 版本失效"，确保安全事件时可全网注销；预缓存仅限未鉴权壳。
3. **离线语义透明化**：离线/服务不可用时显式提示（登录页在 `navigator.onLine === false` 时禁用提交并提示），消除"能填不能登"的误导。
4. **监控补充"隐性服务"信号**：探针只反映进程与依赖连通性；补充"残留进程/端口占用"巡检与告警，避免"进程活着但不服务"的盲区（对应部署 Go/No-Go 报告中的 B3-X / B0-X 硬门）。
5. **纳入 Runbook**：把本次"服务无法可靠关闭"的判定与处置流程写进 `docs/ops/runbook.md`（当前缺失，见技术债报告 文档债 E-01）——这也是**建议的首个 Runbook 条目**（理由：已有可独立复现的触发条件、判定步骤、验收标准与回滚，最接近成熟 Runbook 形态）。

---

## ⚠️ 待完善 / 已知局限

- **T0/T1 精确时刻缺失**：用户未提供关闭服务的具体动作与时间，时间线中窗口期长度无法量化。
- **进程状态受限**：本机 `ps` 返回 `operation not permitted`，无法读取进程启动时长/CPU；服务端 stdout/stderr 为无名管道不可读 → 「启动卡住 vs 监听器崩溃」无法进一步区分。
- **浏览器侧不可观测**：SW / Cache Storage / localStorage 的实际状态需用户在 DevTools 自行确认（E1）。
- **术语表缺口**：`docs/standards/glossary.md` 尚无 Service Worker / PWA / Runbook / origin / app shell / fail-open 词条，建议随 Runbook 落库一并补充。
- **「能登录」的具体含义**：需用户按判定测试确认（无痕窗口 / 检查 `kai-token` / DevTools SW 面板）。

---

## 📚 数据来源 & 成员产出索引

- **Rex（SRE 工程师）** 原始产出：A 实时探测（5 种方法交叉验证：`pgrep` / `lsof` / `netstat` / `curl --noproxy` / `nc`）；B 23 项部署 Go/No-Go 检查清单 + 硬门（B0-X 系列）；C SEV 矩阵 + 沟通模板；D 回滚方案；本次事故 A–F 正式分诊（SEV/时间线/5 Why/失效控制评估/行动项 E1–E7 → 并入本报告 E1–E5/一句话根因）。
- **Docu（技术文档师）** 产出：复盘文档清晰度审校（受众适配 / 规范一致性 / 可执行性 三类意见，已全部采纳并落实到本版）；建议将本事件作为首个 Runbook 条目。
- **主理人** 现场复核：`public/sw.js` 全文件、`src/components/pwa/sw-register.tsx` 全文件、`next.config.ts`、进程表与端口监听状态。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
