# KnowledgeAI 上线体检 · 架构复核报告（Must-fix 独立验证 + 部署就绪评估）

**日期**：2026-10-08  
**复核人**：高见远（Gao）· 架构师（software-architect）  
**团队**：software-kai-launchcheck（Task #2）  
**对象**：`/Users/wsy/Project/KnowledgeAI`，分支 `fix/engineering-assurance-p0-p1` @ `b9e2bc5`（PR #27），以**工作区当前内容**为准  
**证据等级**：【实测】= 已读源码/命令输出/file:line；【推断】= 基于调用链逻辑；【假设】= 无直接证据

---

## 📌 TL;DR

- **结论**：源码层面 S1/S2/S3/S5 与 X1/X2/X3 **确已闭合且设计合理**；S4 为**设计决策规避**（靠单实例），非真正修复。
- **但没有到 Go**：存在三个**发布级阻断**（同源：提交/CI 一致性）——
  1. **工作区有 4 个文件未提交/未推送**（含 `workspace/store.ts` 的 `resolveWorkspace` 行为修正 + smoke 断言修正 + 回归测试）；**发布内容 ≠ CI 验证内容**。
  2. **F17 CORS 源码改动与已提交的 smoke 断言直接冲突**——`HEAD` 的 `test-integrations.ts:76` 仍断言"生产无白名单时回显 Origin"，与 F17 新行为（deny）矛盾，**CI 的 `smoke-infra` job 预计红色**；修正恰恰躺在未提交区。
  3. **CI `smoke` http 组 6 个脚本（`run 36709923366`）共 ~17 项失败，共同根因是 `HEAD` 的 `resolveWorkspace` "owned 优先"顺序**——owner 无 cookie 时漂移到残留工作区；**同一未提交修正可修复全部**（见 §8）。
- **转 Go 条件**：完成本报告"部署前置清单"第 1–3 项（提交推送 4 文件 + 确认 CI 全绿；生产配置 `CORS_ALLOWED_ORIGINS`；自托管设 `LLM_ALLOW_PRIVATE_BASE_URL`）。
- **残留阻塞项**：见 §3——**3 项阻塞本次上线**（均为"提交/CI 一致性"性质），无新增安全阻塞。

---

## 1. Must-fix 逐项验证表

| Item                     | 声称                               | 实测证据（file:line） |           结论           |
| ------------------------ | -------------------------------- | --------------- | :--------------------: |
| **S1** 模型 SSRF           | 5 处 baseUrl 入口接入 SSRF 校验         | 见下              |        ✅ **已修复**       |
| **S2** 跨租户读 + 隔离必填化      | GET 传 workspaceId；4 个校验函数参数必填    | 见下              |        ✅ **已修复**       |
| **S3** KB.workspaceId 落库 | 迁移 + persist/hydrate 读写真实列       | 见下              |   ✅ **已修复**（无索引，见 D8）  |
| **S4** 多实例鉴权内存态          | 报告称"部分缓解"                        | 见下              |    ➖ **设计决策规避**（非修复）   |
| **S5/F4** 自助注册落默认租户      | `ensurePersonalWorkspace` + 回退顺序 | 见下              | ✅ **已修复**（依赖**未提交**改动） |
| **X1/X2/X3** k8s         | replicas=1 + 示例标注 + RWO 说明       | 见下              |        ✅ **已修复**       |
| **部署前置** runbook         | pg_dump + migrate status 回滚点     | 见下              |        ✅ **已覆盖**       |

### S1 模型 SSRF ✅已修复

- `src/lib/security/ssrf.ts` 全文复读：
  - **fail-closed**【实测】：`privateTargetsAllowed()`（:84-88）要求 `NODE_ENV ∈ {development,test}` **且** `SSRF_ALLOW_PRIVATE_HOSTS==="true"`，已从旧 `NODE_ENV !== "production"` 收紧；`NODE_ENV=""`/`staging` 时私网仍被拒（remediation 已由 `ssrf.test.ts` 覆盖）。
  - **云元数据 169.254.0.0/16 永久封禁**【实测】：`isCloudMetadataIp`（:151-163）+ `assertModelIpSafe`（:171-183）在**允许私网前**先判元数据并抛错；含 IPv4-mapped IPv6（`::ffff:169.254.x.x`）与 IPv6 link-local。
  - **`LLM_ALLOW_PRIVATE_BASE_URL` 语义**【实测】：`modelBaseUrlPrivateAllowed()`（:167-169）**不看 NODE_ENV**（生产同样生效），符合"私有端点即自托管生产配置"的决策（D-2）。放行私网但**不放行元数据**。
- 5 个调用点【实测，全部 `await` 且失败即拒（400/跳过）】：
  - `src/app/api/models/route.ts:36-45`（POST create，写路径含 DNS）
  - `src/app/api/models/[id]/route.ts:20-30`（PATCH update，写路径）
  - `src/app/api/models/test/route.ts:33-41`（写路径，且回显前先校验）
  - `src/app/api/models/fetch-list/route.ts:21-28`（写路径）
  - `src/lib/llm/provider.ts:92-107`（**读路径**，`modelBaseUrlPrecheck` 无 DNS 同步预检；不通过则 `log.warn` 并**跳过该模型**回落 env/local）
- 唯一残余缝隙【推断】：读路径预检**不做 DNS**，因此"持久化于修复前的行、其 baseUrl 为公网形态域名但解析到私网"不会被读路径拦截（写路径已拦，仅历史行）。风险低（需历史脏数据 + DNS-rebind），建议后续对历史模型行做一次离线权威校验。

### S2 跨租户读 + 隔离必填化 ✅已修复

- `src/app/api/knowledge-base/[id]/documents/[docId]/route.ts`【实测】：GET/PATCH/DELETE **全部走 `loadDoc()`**，`loadDoc` 在 :21 统一 `canViewDoc(kb, doc, u.id, u.workspaceId)`；PATCH/DELETE 再以 `u.workspaceId` 走 `canEditDoc`（:41/:68）。原 GET 漏传点（旧 :19）已消除。
- 契约必填【实测】：`KbAccessCheckOpts`（`team/store.ts:220-225`）`callerWorkspaceId`/`kbWorkspaceId` 均**必填**；`canViewKb/canEditKb`（:230/:250）签名同；`canViewDoc/canEditDoc`（`kb/store.ts:477-507`）`callerWorkspaceId` 必填 → 漏传即 `tsc` 失败。
- 全仓调用点扫描【实测】：`canViewKb/canEditKb/canViewDoc/canEditDoc` 共 **33 处业务调用**（含 `chat/ask.ts:97,124`、`agent/run-handler.ts:54`、`[docId]/share/route.ts:24,39,70`、`v1/knowledge-bases/**`、`knowledge-base/[id]/route.ts:21,46,67`、`graph`、`search/route.ts:90,109`、`upload/chunk/**`、`integrations`、`bot`）**全部传入 workspaceId**，**无漏传**。

### S3 KB.workspaceId 落库 ✅已修复

- 迁移【实测】`prisma/migrations/20260930120000_tenant_persistence/migration.sql`（**已提交**，`git ls-files` 可见，时间戳位于 `20260828100000` 之后）：  
  `ALTER TABLE "KnowledgeBase" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'ws_default';`  
  `ALTER TABLE "Workspace" ADD COLUMN "members" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];`
- schema【实测】：`KnowledgeBase.workspaceId String @default("ws_default")`（schema.prisma:141）；`Workspace.members String[] @default([])`（:110）。
- 读写路径【实测】：`persist.ts:103` 条件写 `workspaceId`（真值才写，避免旧调用点把行重置回默认）；`hydrate.ts:270` **读真实列**（`kb.workspaceId || "ws_default"`，不再硬编码归并 ws_default）。`persistWorkspace`（persist.ts:776）/`hydrateWorkspace`（hydrate.ts:635-646，DB 为空则保留内存种子）对称。
- **明确回答**：
  - **重启/部署后 KB 不再被归并 `ws_default`**【实测+推断】：新 KB 经 `createKb`（kb/store.ts:371-388，带 workspaceId）→ `persistKb` 写真实列 → 重启后 `hydrateKb` 读回该列。闭环成立。
  - **老数据（无 workspaceId 的历史行）如何处理**【实测】：由 SQL `DEFAULT 'ws_default'` **一次性回填为 `ws_default`**。这与修复前行为**一致**（此前该字段从不落库，重启后一律 ws_default），故**不新增串租**；修复后新建/迁移到其它工作区的 KB 才会正确保真。
- ⚠️ 未给新增 `workspaceId` 加索引（remediation 自认 Ar chi D8，阶段 2）——当前数据量影响可忽略。

### S4 多实例鉴权内存态 ➖设计决策规避（未真正修复）

- 【实测】`src/lib/auth/session.ts:108-133`：JWT `jti` 撤销集仍是 `globalThis` 上的 `Map`（per-process），无 DB/Redis 回源；`verifyToken` 仅查本地集合（:151）。
- 【实测】`src/lib/apikeys/store.ts:97-102`：`validateApiKey` 仍**只扫内存 `keys` 数组**（`safeEqual` 恒定时间比较是 F10 的收益，与多实例无关）；无 miss 回源 DB（hydrate 仅启动跑一次）。
- **触发条件已被消除**【实测】：`k8s/deployment.yaml:57` `replicas: 1`；`docker-compose.yml` 为**单 app + 单 worker**；`scripts/deploy/blue-green.sh` 为**单容器蓝绿**（:93-98）。当前部署形态下无并发多实例，S4 不触发。
- **如实分级**：**当前形态不阻塞；一旦把 app 扩到多副本即立刻回归**（A 实例建的 key 在 B 实例恒 401；撤销的 jti 在 B 实例仍有效）。属 ADR-0006 范畴，应单独立项。

### S5 / F4 自助注册落默认租户 ✅已修复

- 【实测】`src/app/api/auth/register/route.ts:46-50`、`src/lib/auth/oauth-link.ts:87-91`：注册与首次 OAuth 建号均调用 `ensurePersonalWorkspace`（幂等，`workspace/store.ts:139-157`）。
- 【实测】`resolveWorkspace`（`workspace/store.ts:98-119`，**当前工作区版本**）顺序：`requested → 默认(若为成员) → owned → memberOf → 默认`。新注册用户**不是** `ws_default` 成员（`store.test.ts:83-86` 断言），故落到**个人工作区**。
- **原问题消除**：新用户不再回退到默认组织 → 无法读取默认组织非私密 KB。
- ⚠️ **重要**：把"默认(若为成员)"放在"owned"之前的这版逻辑**是未提交改动**（见 §5）。已提交(`b9e2bc5`)版本是 `requested → owned → memberOf → 默认`。

### X1 / X2 / X3 k8s ✅已修复

- 【实测】`k8s/deployment.yaml`：
  - **X1**：`spec.replicas: 1`（:57，原 2）；worker `replicas: 1`（:129）。
  - **X3**：文件头 :1 起为"⚠️ 示例清单（EXAMPLE ONLY）—— 不可直接用于生产" + 三条扩容前置条件（:10-13）。
  - **X2**：PVC `accessModes: ReadWriteOnce`（:41-42）+ "Multi-Attach 开箱即坏"说明（:38-40）；app 侧 `:54-56` 说明内存 store 为读路径事实源、多副本静默失效。
- 与旧报告 X1/X2/X3 的 ❌ 一一对应转为 ✅。

### 部署前置 runbook ✅已覆盖

- 【实测】`docs/ops/runbook.md`：**RB-02**（:116-152）明确 `pg_dump "$DATABASE_URL" -Fc -f backup-...dump` 全量备份 + `npx prisma migrate status` 登记回滚点 → 覆盖 Go/No-Go 行动项 #5（B0-6）。
- 【实测】RB-02:151-152 明确"**若已执行破坏性迁移（如 `20260816100000_drop_dead_tables`）禁止直接回滚镜像**，只能前向修复或快照恢复"——与安全报告一致。
- RB-01（SW/进程残留）、RB-03（队列积压）齐备，并已在 VitePress 导航（remediation 声称，未逐字复核导航文件）。

---

## 2. 回归风险结论表

| 变更                                             |        结论       | 证据与影响                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | :-------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F17 CORS 收紧**（`proxy.ts:192-213`）            | ⚠️ **高风险 / 阻断** | 【实测】`corsHeaders` 规则：白名单命中→回显；**无白名单且生产→不返回 ACAO**（拒）；`Vary: Origin` 恒发。**对已有第三方 widget**：生产若未配 `CORS_ALLOWED_ORIGINS`，跨域预检失败、widget 调用被浏览器拦断。**关键冲突**：`HEAD` 的 `scripts/smoke/test-integrations.ts:76` 仍断言"生产回显 Origin"，与新行为矛盾 → **CI `smoke-infra` 预计 RED**；修正恰为未提交。文档侧 `docs/ops/env-vars.md:46:60` 仍描述 CORS 为"空（反射任意 Origin）"，**未同步 F17 生产 deny 语义**（文档漂移）。 |
| **E3 SW kill switch**（`public/sw.js`）          |   ✅ fail-safe   | 【实测】`isRemotelyDisabled()`（:88-97）fetch 失败/非 ok **返回 false（保持启用）**——对"kill switch 拉取失败"而言是可用性优先，符合 RB-01 期望（失败时仍给显式离线页）。`selfDestruct()`（:100-104）清全部缓存 + `unregister()`。                                                                                                                                                                                       |
| **E4 预缓存收窄**（`sw.js:45-53`）                    |        ✅        | 【实测】`APP_SHELL` 仅 `/, /login, manifest, icons`；`/dashboard` `/knowledge-base` `/chat` `/agent` 已移除；navigate 失败返回自带 **HTTP 503 离线页**（:55-84,167），不再回退缓存已鉴权页。                                                                                                                                                                                                     |
| **F9 限流降级可见化**（`rate-limit.ts`）                |      ✅ 无回归      | 【实测】降级计数器 + 节流 WARN（:247-260）+ 恢复 info（:267-269）+ `getRateLimitHealth`（:275-287）供 `/health/ready`。行为增强，不改 429 语义。                                                                                                                                                                                                                                               |
| **F16 队列状态**（`bullmq-queue.ts:156-173`）        |      ✅ 无回归      | 【实测】`job.getState()` + `toQueueStatus` 映射；unit 测试 mock 需同步（remediation 已改 `bullmq-queue.test.ts`）。                                                                                                                                                                                                                                                              |
| **F1 读路径预检误伤自托管 LLM**（`provider.ts:92-107`）    |   ⚠️ 中（可配置规避）   | 【实测】修复前持久化的私有 baseUrl 行、且未设 `LLM_ALLOW_PRIVATE_BASE_URL=true` 时：precheck 拒绝 → **静默跳过用户模型、回落 env/local**（不报错、不崩溃）。放行方式：运营设 `LLM_ALLOW_PRIVATE_BASE_URL=true`（元数据仍拒）。**若部署唯一依赖该用户模型 → 生成退化为演示模式**，需在 env 到位。                                                                                                                                                      |
| **F7/F8 上传校验**（`upload/store.ts` + `chunk/**`） |       ✅ 正确      | 【实测】单片 `chunk.size > session.chunkSize` → 413（chunk/[uploadId]/route.ts:48-56）；`receivedBytes` 累计 `> fileSize` → 413（:66-72）；`complete` 处 `validateFile(name, 0)` 仅类型校验（complete/route.ts:50-53），大小由 init 的 `MAX_CHUNKED_UPLOAD_MB`（init/route.ts:46-52）兜住——口径自洽、注释说明充分。                                                                                        |
| **F12 billing webhook**（`webhook/route.ts`）    |        ✅        | 【实测】`JSON.parse` 包 try/catch（:45-51，非 JSON → 200 ignored）；`event.id` 环形去重 500（:20-30,54-56）。                                                                                                                                                                                                                                                                    |
| **F10 时序侧信道**                                  |        ✅        | 【实测】`session.ts:195-224` 对派生字节恒定时间比较；`apikeys/store.ts:89-94` `safeEqual` 用 `timingSafeEqual`（长度不等直接 false）。                                                                                                                                                                                                                                                    |

---

## 3. 残留风险分级

### 🔴 阻塞本次上线

|  #  | 风险                                                                                                  | 证据                                                                                                                                          | 处置                                                                   |
| :-: | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|  B1 | **F17 源码 ↔ 已提交 smoke 断言冲突** → CI `smoke-infra` 预计 RED                                               | 【实测】`HEAD:scripts/smoke/test-integrations.ts:76` 断言 reflect；F17 源码 deny；断言修正**未提交**                                                         | 提交并推送 smoke 修正，重跑 CI 确认全绿                                            |
|  B2 | **4 个文件未提交/未推送**，发布内容 ≠ 已验证内容                                                                       | 【实测】`git status`：`remediation-*.md`(+1)、`scripts/smoke/test-integrations.ts`、`src/lib/workspace/store.test.ts`、`src/lib/workspace/store.ts` | 提交推送后再判 Go；未提交前 CI 覆盖不到这些改动                                          |
|  B3 | **CI `smoke` http 组 6 脚本 ~17 项失败**，共同根因 = `HEAD` `resolveWorkspace` owned 优先导致 owner 无 cookie 工作区漂移 | 【实测】`HEAD:workspace/store.ts:98-119`（requested→owned→memberOf→default）；失败断言全部为"无 cookie ⇒ ws_default"假设（详见 §8）                              | 提交 `workspace/store.ts` 未提交修正后可修复**全部**（§8.2 推演）；**勿**靠回退各路由租户校验"修复" |

### 🟡 可推迟（附补偿措施）

|            #            | 风险                                              | 补偿措施                                                                    |
| :---------------------: | ----------------------------------------------- | ----------------------------------------------------------------------- |
|            F5           | 读路径存储（jti 黑名单 / apikey 校验内存态）per-instance       | `replicas:1` + 单容器蓝绿/compose + k8s 扩容前置条件 + ADR-0006。**扩容前必须落地，否则立刻回归** |
|          X5/X6          | 队列无深度/内存背压上限（1Gi limit → OOMKilled）             | RB-03 人工巡检；临时降 `QUEUE_*_CONCURRENCY` / 提 `limits.memory`；单独立项           |
|            —            | 依赖 CVE 未审计（无 `pnpm audit`）                      | 在 CI 内补 `pnpm audit`（失败不阻断或按档）                                          |
|            D8           | 新增 `KnowledgeBase.workspaceId` 无索引              | 数据量增长后补；当前影响可忽略                                                         |
|       F14/F15/F18       | pgvector 逐条 INSERT / hydration N+1 / KbChunk 双轨 | 低优先，单独立项                                                                |
| ADR-0003/0004/0006/0007 | 未写正式 ADR                                        | 决策已散落于 remediation + runbook，补 ADR 归入阶段 2                               |
|            —            | X4 探针盲区（探针无法发现租户串租）                             | 依赖 S3 持久化闭环消除成因；仍建议加"KB 归属抽查"巡检                                         |

---

## 4. 部署前置清单（Go 之前必须完成）

1. **提交并推送 4 个未提交文件**（尤其 `src/lib/workspace/store.ts` 的 resolveWorkspace 修正 + `scripts/smoke/test-integrations.ts` 的 F17 断言修正 + `src/lib/workspace/store.test.ts` 回归测试），随后确认 **CI 7 job 全绿**（重点 `smoke` / `smoke-infra` / `e2e`）。
2. **生产显式配置 `CORS_ALLOWED_ORIGINS`**（逗号分隔完整 origin），否则第三方 widget 跨域调用被拒；同时**修正 `docs/ops/env-vars.md:60`** 对 CORS 的描述（当前写"空（反射任意 Origin）"，与 F17 生产 deny 不符）。
3. **自托管 LLM 部署**：在 app 环境设 `LLM_ALLOW_PRIVATE_BASE_URL=true`（并确认 `SSRF_ALLOW_PRIVATE_HOSTS` 在生产保持 false）；否则用户私有 baseUrl 静默失效、回落演示模式。
4. **DB 回滚点**：`pg_dump "$DATABASE_URL" -Fc` 全量备份 + `prisma migrate status` 登记（RB-02）；迁移**先于**应用新版执行且向下兼容。
5. **注意破坏性迁移**：`20260816100000_drop_dead_tables` 已存在 → **禁止部署后直接回退镜像**，回滚只能前向修复或快照恢复。
6. **预发环境补测 B1–B3 运行时项**：Postgres/Redis/pgvector 可达、`/api/health` `/api/health/ready`、worker 起、真实链路 smoke。
7. **保持 app `replicas:1`**（k8s）；未满足文件头三条扩容前置条件前**勿扩容**。


## 6. 未提交文件风险（专项）

`git status` 显示 4 个未提交文件，均为"让修复自洽"的关键件：

| 文件                                   | 未提交改动的作用                                                                                   | 风险                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `src/lib/workspace/store.ts`         | 把 resolveWorkspace 由"owned 优先"改为"默认成员优先"（修正 committed 版本会**把 demo 用户移出 ws_default** 的行为回归） | 未提交 → PR/CI 不含此修正 → 已推送版本存在**行为回归**；`store.test.ts` 新增回归用例亦未提交 |
| `scripts/smoke/test-integrations.ts` | 把 CORS 断言由 reflect 改为 deny（适配 F17）+ 新增 :3100 白名单命中用例                                       | 未提交 → 已提交 smoke 与 F17 冲突 → **CI smoke-infra 红**                |
| `src/lib/workspace/store.test.ts`    | 新增"默认成员优先"回归用例                                                                             | 未提交 → 回归防线缺失                                                   |
| `remediation-*.md`                   | +PR 链接一行                                                                                   | 文档性，低                                                          |

**风险结论【实测/推断】**：**工作区 ≠ `b9e2bc5`**，而 CI 判定的是后者。当前"报告声称全绿"与"发布内容实际状态"存在缺口——这正是本次体检最应拦截的问题。

---

## 7. 架构视角 Go / No-Go 建议

> **建议：当前 No-Go（可快速转 Go）。**

**依据**：

- **正向**【实测】：Must-fix 清单中的**安全阻塞**（S1 SSRF、S2 跨租户读 + 契约必填、S3 租户持久化、S5 自助注册）与**部署配置**（X1/X2/X3 k8s）在**源码/配置层面确已闭合**，且修复方式（类型系统强制隔离契约、模块内环境策略收敛 SSRF 逃生口、列级持久化租户归属）**设计合理、无过度抽象**，符合"简单、可用、完整"的方向。相较上次 No-Go，**无新增安全阻塞**。
- **负向（阻断）**：
  1. **发布工程一致性**——4 个关键修正文件未提交/未推送，CI 覆盖不到（§6）；
  2. **CI 预计红色**——F17 源码与已提交 smoke 断言冲突（`smoke-infra`），且 `resolveWorkspace` 顺序 bug 令 `smoke` http 组 6 脚本 ~17 项失败（§5.3、§8）；
  3. **一项渲染隔离语义待确认**——graph 路由"公开=同租户"的硬 `kb.workspaceId !== u.workspaceId` 校验（§8.3），若产品需跨租户公开只读则需架构决策；
  4. **两项环境前提**——生产 `CORS_ALLOWED_ORIGINS`、自托管 `LLM_ALLOW_PRIVATE_BASE_URL` 需在部署环境显式配置，否则出现"widget 断"或"用户模型静默失效"的功能性回归。
- **收敛口径**：完成 §4 清单 **第 1–3 项**（提交推送 + CI 全绿 + 两项 env 到位）后即可转 **Go**；S4/F5 与队列背压作为**扩容/后续里程碑的前置门禁**，不阻断本次单实例上线。

---

## 8. CI 失败根因初判（逐脚本 · run 36709923366 @ b9e2bc5）

> 本节为**静态推演**（读脚本断言 + 读 API 实现 + 读 `HEAD`/工作区差异）；QA（software-qa-engineer）正本地实测复现这些脚本，**若与实测分歧以实测为准**。证据等级照旧。

### 8.0 共同根因 A：`HEAD` 的 `resolveWorkspace` "owned 优先"顺序

- 【实测】`HEAD` 版 `resolveWorkspace`（`workspace/store.ts:98-109`）：顺序 `requested → owned → memberOf → 默认`；其注释自述第 2 步为"a workspace the user OWNS"。
- 【实测】smoke 脚本普遍假设"**无 `kai-workspace` cookie ⇒ 默认工作区 `ws_default`**"（如 `test-global-search.ts:143/154/158`、`test-workspaces.ts:71/81/87/95/108/132`）。
- 【推断】演示用户（owner/editor 等，均为 `ws_default` 种子成员）**一旦在脚本中新建过工作区**，其"无 cookie"请求就被 `owned`（按 `createdAt` 取最近）命中**该残留工作区**，于是：
  1. owner 中途"换租户"→ 同一脚本内前后请求落在不同工作区；
  2. owner（漂移工作区）与 editor/viewer（仍 `ws_default`）**跨用户视角错位**。
- 【实测】未提交的 `workspace/store.ts` 修正在 `requested` 之后插入"若为默认工作区成员则返回默认"分支（§6 的 `git diff`），使演示用户无 cookie 时**稳定落 `ws_default`**，显式 `ws=…` cookie 仍优先；新增用例 `store.test.ts:55-70` 恰为此点。

### 8.1 逐脚本失败根因判定

| 脚本                                  | 失败断言（file:line）                                                                                                                                                                                                                                                                                                                          | 根因分类                      | 证据 / 推演链                                                                                                                                                                                                                                                                                                                                                            | 修复方                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **test-global-search**（3 项）         | `:144`「ws-B KB invisible from default ws」（结果含 `P52-WSB-专属知识库`）；`:155`「ws-B task NOT in default ws list」；`:159`「ws-B task NOT hit from default ws」                                                                                                                                                                                        | 【与未提交修正直接相关（可被其修复）】       | 【实测】§4 `:137` owner 建 `P52 搜索隔离区`(wsB)、`:140` owner 建 `P52-WSB-专属知识库`；`leakDefault`/`tasksDefault`/`leakSearch` 均无 cookie → owner 漂移到 wsB → 实际在 wsB 上下文，"看得到" ws-B 的 KB/任务而失败。未提交修正后 owner→`ws_default` → 三项回归 ✓                                                                                                                                                    | 提交 `workspace/store.ts` |
| **test-workspaces**（8 项，推演）         | `:73`「KB-B NOT visible in default」；`:74`「KB-A visible in default」；`:82`「cross-workspace KB access denied(403)」（实得 200）；`:89`「ws-B conversation NOT in default list」；`:95`「editor's default current workspace」(实得 wsB)；`:108`「usage default meters ws_default」；`:120`「QA counted in default」；`:132`「unknown cookie falls back to default」 | 【与未提交修正直接相关（可被其修复）】       | 【实测】`:56` owner 建 `Workspace B` 后无 cookie 漂移到 B；editor 非任何工作区 owner → `memberOf` 取最近（wsB）→ `currentWorkspace≠ws_default`。逐条与"无 cookie⇒default"假设冲突。未提交修正后 owner/editor 均→`ws_default`，8 项回归 ✓                                                                                                                                                                       | 提交 `workspace/store.ts` |
| **test-kb-permissions**（3 项，明细待 QA） | 最可能 `:67`「editor can read inherited doc(200)」、`:95`「viewer override grants access(200)」、`:97`「viewer(editor override) can edit(200)」                                                                                                                                                                                                     | 【与未提交修正直接相关（可被其修复）】·【推断】  | 【实测】`:48` owner 建 `permissions-test` KB → 漂移工作区；`canViewDoc`（`kb/store.ts:477-489`）无 doc 级短路 → workspace 不符 → editor/viewer 得 403。**注意** `:80`「edit grants delete」**能通过**——`canEditDoc` 对 `doc.access==="edit"` 直接 `return true`，**短路于 workspace 校验之前**（`kb/store.ts:502`）；`:111` audit≥3 是否失败取决于跨脚本累计/顺序。未提交修正后 owner→`ws_default`，KB 与 editor/viewer 同租户 → 三项回归 ✓ | 提交 `workspace/store.ts` |
| **test-theme**（1 项）                 | `:84`「viewer GET: 可见品牌色(只读)」                                                                                                                                                                                                                                                                                                             | 【与未提交修正直接相关（可被其修复）】       | 【实测】owner 无 cookie 漂移到残留自有工作区，`:72` `PATCH brandColor=emerald` 改的是**该工作区**；viewer 无 cookie→`ws_default`（其唯一成员关系）→ `:84` 读回 `indigo≠emerald`。与权限无关（viewer GET 只读且通过）。未提交修正后 owner/viewer 同租户 → emerald 一致 ✓                                                                                                                                                          | 提交 `workspace/store.ts` |
| **test-webhooks**（1 项）              | `:272`「delete webhook: 200」（实得 **404**）                                                                                                                                                                                                                                                                                                  | 【与未提交修正直接相关】＋【与已提交租户校验相关】 | 【实测】`subId` 于 `:97`（无 cookie）在 owner 当时的 ws 创建；`:181` owner 又建 `告警验收空间` → owner 无 cookie 漂移到新工作区；`:271` DELETE 时 `v1/webhooks/[id]/route.ts:84` `sub.workspaceId !== u.workspaceId → 404`。**即：路由新增的租户校验（+5/-3，本身正确）暴露了 `resolveWorkspace` 漂移**。未提交修正后创建/删除同租户 → 200 ✓。**切勿**靠回退该租户校验"修复"（会重开跨租户删/改/读，`:32/:84/:113`）                                                | 提交 `workspace/store.ts` |
| **test-graph-rag**（1 项）             | `:149`「graph 公开库 viewer: 200」（实得 **403**）                                                                                                                                                                                                                                                                                                | 【与未提交修正直接相关（可被其修复）】       | 【实测】`:75` owner 无 cookie 建 `图谱验收库` → 漂移工作区；viewer→`ws_default`；`knowledge-base/[id]/graph/route.ts:21` `kb.workspaceId !== u.workspaceId → 403`。**非"公开库只读"被误伤**——设计上"公开"限定同租户（与全仓一致）；错在 KB 落错租户。未提交修正后同租户 → 200 ✓                                                                                                                                                   | 提交 `workspace/store.ts` |

### 8.2 (b) 特别推演：未提交修正能否修复 test-global-search(3) + test-workspaces(8)？

**能【实测+推断】**：

1. 两脚本均由 `owner@knowledgeai.dev`（`ws_default` 种子成员）执行，且脚本内 owner **新建工作区**（`P52 搜索隔离区`／`Workspace B`）→ 其 `ownerId=owner`；
2. `HEAD` 顺序下，owner 一旦有自有工作区，**无 cookie** 请求即 `owned`（最近）= 新建 wsB，**不再回 `ws_default`**；
3. 断言 `:144/:155/:159` 与 `:73/:74/:82/:89/:108/:120/:132` 全部以"无 cookie ⇒ `ws_default`"为前提 → 全落在 wsB 上下文而失败（editor 侧 `:95` 同理：editor 非 owner，`memberOf` 取最近=wsB）；
4. 未提交修正把"是否 `ws_default` 成员"提到 `owned` **之前** → owner/editor 均为 `ws_default` 成员 → 无 cookie 一律回 `ws_default`；显式 `ws=wsB` 仍先命中 `requested`；
5. 故上述 3 + 8 项全部回归预期值（旁证：新增用例 `store.test.ts:55-70` 精确描述该机制，即此改动**正是为这批失败所打**）。

### 8.3 (c) 三个专项判定

- **test-webhooks DELETE 404 ↔ `v1/webhooks` 路由新增租户校验**：**是**。该校验（`v1/webhooks/[id]/route.ts:32/84/113`）本身**正确**（防跨租户删/改/读）；404 的直接成因是 owner 无 cookie 工作区漂移。**正解是提交 resolveWorkspace 修正，不可回退校验。**
- **test-graph-rag 公开库 403 ↔ 权限收紧误伤**：**不是跨租户误伤**。`graph/route.ts:21` 的 `kb.workspaceId !== u.workspaceId → 403` 与全仓一致（"公开 = 同租户内可读"）；403 源于 KB 落错租户。⚠️ 唯一需**人类确认的设计点**：若产品语义要求"公开 KB 可**跨租户**只读"，则该硬校验将误伤——建议在 ADR-0003/0004 显式记录当前取"同租户"。
- **test-theme viewer 品牌色失败 ↔ workspace 解析/权限**：**是**（workspace 解析）。owner 与 viewer 因漂移解析到**不同工作区**，而 `brandColor` 是工作区级字段，故 viewer 读不到 owner 刚改的值；**与权限无关**（viewer GET 为只读且通过）。

### 8.4 结论与修复建议

- **6 个脚本 ~17 项失败同源**，均为【与未提交修正直接相关（可被其修复）】；**无一项是新增的真实安全回归**。
- **唯一修复动作**：提交并推送 `src/lib/workspace/store.ts`（+ `store.test.ts` 回归用例）；随后重跑 CI，`smoke` http 组应转绿。
- **禁止**把失败"修复"为回退各路由的租户校验（`v1/webhooks/[id]`、`graph`、`knowledge-base/[id]` 等）——那会重开被 S2/F11 关闭的跨租户面。

---

*本报告为只读复核产出（未修改任何业务代码），关键决策请由人类工程负责人复核。*
