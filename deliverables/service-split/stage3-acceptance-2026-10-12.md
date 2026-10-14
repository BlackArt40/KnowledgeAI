# 阶段三验收报告：AI 侧租户硬化

> 依据 [服务拆分实施手册](../../docs/architecture/service-split.md) 阶段 3 的验收标准（A3.1～A3.5）逐项记录。
> AI 辅助执行与编写，结果由实际运行产出。

| | |
|---|---|
| 日期 | 2026-10-12 |
| 验收对象 | Python AI 服务的 index/delete 租户校验、BFF 禁止默认租户回退、负例套件入 CI |
| 说明 | 阶段 1 已提前落底 chunk 级 `workspace_id` 双匹配（A3.1 的基础）；本阶段补齐写入/删除路径的归属校验与 CI 门禁 |
| 开关 | `AI_SERVICE_URL=http://127.0.0.1:8000` + `AI_INTERNAL_TOKEN`（仅验证进程环境） |

## 一、交付物

| 工作包 | 文件 | 说明 |
|---|---|---|
| 3.1 schema（+delete 过滤） | `services/ai/app/store.py` | chunk 携带 `workspace_id/kb_id/doc_id`（阶段 1 落底）；本阶段补 `get_kb_ownership(kbId)`（KB 当前归属，供写入/删除校验）；**delete 路径同样强制过滤**（手册 3.1「所有 retrieve/index/delete」） |
| 3.2 拒绝空租户 | `services/ai/app/main.py`、`src/lib/kb/store.ts` | Python：`workspaceId` 缺失/空串 → 400（index 与 delete 一致）；TS：`processDocInQueueRemote` 移除 `?? DEFAULT_WORKSPACE_ID` 回退——KB 缺失即明确失败，不落入默认租户 |
| 3.3 双写校验 | `services/ai/app/main.py` | index 写入前校验归属一致性：kbId 已归属 wsX 而本次请求为 wsY → **400 `tenant_mismatch`**（BFF 侧 `canViewKb` 校验保持不变，构成纵深防御）；retrieve 双匹配维持（阶段 1） |
| 3.4 负例套件入 CI | `services/ai/tests/test_contract.py`、`.github/workflows/ci.yml` | 固定夹具 wsA/kbA + wsB/kbB 的全交叉矩阵测试；新增 **`ai-contract` CI job**（setup-python 3.12 + pytest），负例与契约回归随 CI 门禁执行 |
| 3.5 GraphRAG | `src/lib/kg/store.ts`（审查确认，无改动） | 实体/关系 ID 与索引全部由 `(kbId, label)` / `(kbId, source, target)` 派生（[store.ts#L40-L44](../../src/lib/kg/store.ts)），labelIndex key 为 `${kbId}:${label}`，docGraphs 按 kbId 分桶——**图谱数据天然按 KB 隔离**，KB 唯一归属一个 workspace（ADR-0003），故 1-hop 扩展不可能跨库 |

同步更新：`AGENTS.md`（CI 门禁 seven → eight jobs，含 `ai-contract` 描述；分支保护要求同步改为八项检查）。

## 二、验收标准逐项记录

| 编号 | 标准 | 结果 | 证据 |
|------|------|:----:|------|
| A3.1 | 用 wsB 的身份检索 kbA → 0 hits | ✅ | ① `test_cross_tenant_matrix`：wsA/kbA + wsB/kbB 双夹具，4 个交叉组合——跨租户 2 组恒空、同租户 2 组有结果；② 运行实例 curl：`ws_b` 检索 `kb_neg` → `{"ok":true,"chunks":[]}`；③ 阶段 1 起即有 `test_cross_tenant_zero_hits` 锁定 |
| A3.2 | index 时 workspace 与 kb 归属不一致 → 400 | ✅ | ① `test_tenant_mismatch_index_400`：wsA 写入 kb_shared 后 wsB 再写 → **HTTP 400** + `code:"tenant_mismatch"`，且 wsA 视角检索不到 wsB 的文档；② 运行实例 curl：`HTTP 400 {"ok":false,"code":"tenant_mismatch"}` |
| A3.3 | 缺 workspaceId → 400，不写入 | ✅ | ① `test_missing_workspace_400`（阶段 1 起）；② delete 路径同语义：缺失 → 400（`test_delete_workspace_enforcement` + curl `HTTP 400 invalid_request`）；③ BFF 侧不再默认 `ws_default`（KB 缺失 → 文档 failed，报「无法确定租户归属」） |
| A3.4 | 同租户问答与阶段 1 无显著差异 | ✅ | 开关 ON 端到端：上传 md → ready；SSE 帧序不变（`sources→token×36→done`）；引用 1 条指向本文档（`docId` 一致）；答案内容与阶段 1 同源（含「2030 年前完成深空组网」） |
| A3.5 | ADR-0003 相关权限测试仍绿 | ✅ | `pnpm test:unit` exit 0（team/kb/workspace 权限单测，coverage 80.57%/67.26%）；`pnpm test:e2e` **10/10**（含跨租户页面访问用例） |

**本地门禁**：`npx tsc --noEmit` 零错误；`pnpm lint` exit 0；`pytest services/ai/tests -q` **25/25 passed**（新增 6 条租户硬化负例）。

## 三、运行实例负例证据（直连 Python，`X-Internal-Token` 均携带）

| 场景 | 请求 | 响应 |
|---|---|---|
| A3.2 写入越权 | wsB 对已归属 wsA 的 `kb_neg` index | `HTTP 400 {"ok":false,"code":"tenant_mismatch","message":"kbId 已归属其他 workspace，拒绝写入"}` |
| A3.1 检索越权 | wsB 检索 `kb_neg` | `200 {"ok":true,"chunks":[]}`（恒空且不 500） |
| delete 缺租户 | DELETE 不带 `workspaceId` | `HTTP 400 invalid_request` |
| delete 越权 | `?workspaceId=ws_b` 删 wsA 的对象 | `HTTP 403 {"ok":false,"code":"tenant_mismatch"}`，对象未被删除（检索仍有结果） |
| delete 正确 | `?workspaceId=ws_a` | `{"ok":true}`；幂等重复删除亦放行 |

## 四、语义设计说明

1. **首写定归属**：KB 首次索引时归属未定，允许写入（`get_kb_ownership` 返回 None）；此后任何非同租户写入 → 400。空索引的重复删除视为幂等操作放行（避免业务侧重试永远失败）。
2. **delete 过滤是防御性校验而非鉴权边界**：真正的删除权限在 BFF（`canEditDoc`/`canEditKb` + `recordAudit`）；Python 层校验的是「载荷租户与数据归属一致」，拦截的是 BFF 缺陷（传错租户/漏传）造成的越权破坏。
3. **workspaceId 随 `index-cleanup` 载荷透传**：`deleteDocument`/`deleteKb` 从内存 KB 行取归属传入队列 → handler → `remoteClearIndex(?workspaceId=)` → Python 校验。
4. **CI 合并门禁提示**：`ai-contract` 为第 8 个 CI job；GitHub 分支保护的 required checks 需在仓库设置里补加 `ai-contract`（仓库设置侧操作，代码无法配置）。

## 五、回滚方式

- 归属一致性/删除过滤：纯 Python 侧校验，回滚即移除 `_check_delete_tenant` 与 index 前置校验（行为回到「双匹配读取 + 无写入校验」）；
- BFF 默认租户回退移除：不可单独回滚为默认租户（与 A3.3 冲突）；若确需临时绕过，恢复 `?? DEFAULT_WORKSPACE_ID` 即可（不推荐）；
- `ai-contract` CI job：删去 yml 段落即回七 job 形态。

## 六、阶段小结（简历轨道交付点）

手册规定「阶段 3 完成即简历轨道可交付演示」。当前演示路径：

1. `docker compose up -d minio minio-init`（或任意 S3 兼容存储）；
2. `AI_SERVICE_URL=http://localhost:8000 AI_INTERNAL_TOKEN=<token> S3_* pnpm dev` + `services/ai` 侧 `uvicorn app.main:app`；
3. 登录 → 上传 → 问答全链路走 Python AI 服务；租户负例由 `pytest services/ai/tests`（CI `ai-contract` job）持续锁定。

阶段 4（拆业务服务，Java/Go）为生产轨道内容，开工前需按手册先写语言选择 ADR。
