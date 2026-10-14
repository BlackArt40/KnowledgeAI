# 阶段一验收报告：绞杀式抽出 Python RAG

> 依据 [服务拆分实施手册](../../docs/architecture/service-split.md) 阶段 1 的验收标准（A1.1～A1.9）逐项记录。
> AI 辅助执行与编写，结果由实际运行产出。

| | |
|---|---|
| 日期 | 2026-10-12 |
| 验收对象 | `services/ai/`（FastAPI AI 服务）+ `src/lib/rag/remote.ts`（BFF 适配器）+ 开关接线 |
| 开关状态 | `AI_SERVICE_URL=http://127.0.0.1:8000`、`AI_INTERNAL_TOKEN=<32位演示令牌>`（仅验证进程环境，未写入 `.env.local`） |
| 环境 | macOS / Python 3.14.7（本地 venv）/ Node 22 / `pnpm dev` 内存演示模式（无 DATABASE_URL） |

## 一、交付物

| 模块 | 文件 | 说明 |
|---|---|---|
| AI 服务 | `services/ai/app/main.py` | `/internal/index`、`/internal/retrieve`、`/internal/chat/stream`、`DELETE /internal/index/{kbId}[/{docId}]`、`/health`；`X-Internal-Token` 中间件（未配置令牌 = 全部 401，fail-closed）；JSON 访问日志带 `traceId` |
| 解析 | `services/ai/app/parser.py` | 1a：md/txt/csv/字幕/html；pdf（pypdf）/word（python-docx）/excel（openpyxl）；OCR/PPT 显式报 `unsupported_format`（迭代 1b） |
| 切片 | `services/ai/app/chunker.py` | `chunker.ts` 移植：标题感知、表格/代码块保全、密度动态大小、`[节 > 路径]` 前缀 |
| 检索 | `services/ai/app/{embeddings,bm25,retrieval,store}.py` | 本地哈希嵌入与 TS 逐位对齐（FNV-1a 2048 维）；BM25 + 向量 RRF 融合（k=60，0.5/0.5）；chunk 强制携带 `workspace_id`，检索双匹配（跨租户恒 0 hits） |
| 生成 | `services/ai/app/generation.py` | 演示抽取式（`generator.ts` 移植，`[n]` 引用原子流式）；配置 `OPENAI_API_KEY` 后走 OpenAI 兼容流式 |
| BFF 适配器 | `src/lib/rag/remote.ts` | `remoteIndexDocument` / `remoteRetrieve` / `remoteGenerateStream` / `remoteClearIndex`；`X-Trace-Id` 透传；SSE 帧解析 |
| 接线 | `src/lib/chat/ask.ts`、`src/lib/queue/handlers.ts`、`src/lib/kb/store.ts` | chat 检索/生成分支；`doc-process` 走 `processDocInQueueRemote`；`index-cleanup` 走远端清理（失败进队列重试/死信） |
| 配置 | `src/lib/config.ts`、`.env.example`、`docs/ops/env-vars.md` | 新增 `AI_SERVICE_URL` / `AI_INTERNAL_TOKEN`（两侧 parity，admin 面板可见状态） |
| 部署 | `docker-compose.yml`、`services/ai/Dockerfile` | `ai` 服务仅内网（不映射宿主端口）；共享 uploads 卷（只读）供 file:// 源 |
| 测试 | `services/ai/tests/test_contract.py` | 15 条契约测试（见下） |

## 二、验收标准逐项记录

| 编号 | 标准 | 结果 | 证据 |
|------|------|:----:|------|
| A1.1 | 开关打开后上传 Markdown → 状态 ready | ✅ | `POST /api/v1/knowledge-bases/{id}/documents` → 轮询至 `status=ready`，`chunks=1`（Python 返回实际切片数） |
| A1.2 | 提问 SSE 仍为 `sources → token* → done`，答案含引用 | ✅ | 帧序 `sources,token×43,done`；token 拼接含 `[1]` 标记；done 帧 `citations=1` 指向所传文档；答案含索引原文（"2030 年前完成深空组网"） |
| A1.3 | SDK / `/api/v1/chat` 路径不变 | ✅ | `handleChatRequest` 为 `/api/chat` 与 `/api/v1/chat` 共用入口，签名未动；done 帧 `conversationId`/`messageId` 正常返回 |
| A1.4 | 无/错 `X-Internal-Token` → 401；宿主端口映射默认关闭 | ✅ | `test_missing_token_401` / `test_wrong_token_401` / `test_unconfigured_token_401`；compose `ai` 服务不发布端口，本地 uvicorn 绑定 127.0.0.1 |
| A1.5 | 直连 Python 即使用户 JWT 也不能列 KB | ✅ | AI 服务无任何业务端点：JWT 透传只会命中 401（`/internal/*` 全部要求内部令牌）；契约测试覆盖 |
| A1.6 | Next 与 Python 日志携带同一 trace id | ✅ | AI 服务日志：`/internal/retrieve` 与 `/internal/chat/stream` 两行均带 `traceId: 55040425-4e96-480d-aed9-fc4889a5e413`（与 BFF `X-Trace-Id` 一致） |
| A1.7 | 停掉 AI 服务后问答返回可重试错误，不 500 HTML | ✅ | `pkill uvicorn` 后提问 → `503` + `Content-Type: application/json` + `Retry-After: 30`，body `{"error":"AI 服务暂时不可用，请稍后重试","retryable":true}` |
| A1.8 | `AI_SERVICE_URL` 清空后 e2e 仍绿（回滚） | ✅ | 无开关环境跑 `pnpm test:e2e`：10/10 passed（1.9m） |
| A1.9 | P95 首 token ≤ 基线 2 倍（记录即可） | ✅ | 开关开（Python 演示抽取式）：28～128ms；开关关基线（本机 `.env.local` 配置了真实 LLM，TS 进程内走 LLM 流式）：20507～34306ms。远端路径远低于基线 |

**本地门禁**：`pnpm lint` exit 0；`pnpm test:unit` exit 0（覆盖率 lines 80.62% / branches 67.26%，高于 70%/60% 阈值）；`npx tsc --noEmit` 零错误；`python3 -m pytest services/ai/tests -q` 15/15 passed。

## 三、契约测试清单（services/ai/tests/test_contract.py）

| 测试 | 覆盖点 |
|---|---|
| `test_missing_token_401` / `test_wrong_token_401` / `test_unconfigured_token_401` | A1.4 fail-closed（含服务端未配置令牌场景） |
| `test_health_open` | `/health` 无鉴权（探针可用） |
| `test_index_and_retrieve` | 索引 → 检索主路径，返回字段契约（docId/docName/chunkIndex/text/score） |
| `test_cross_tenant_zero_hits` | 租户隔离：ws B 检索 kb A 恒 0 hits（A3.1 提前落底） |
| `test_missing_workspace_400` / `test_missing_query_400` | 400 语义（A3.2/A3.3 提前落底） |
| `test_reindex_replaces_doc` | 重建索引覆盖旧分块 |
| `test_delete_doc` | 远端索引清理（index-cleanup 对接） |
| `test_file_source_outside_uploads_forbidden` | file:// 源必须位于 `AI_UPLOADS_DIR` 内（防任意文件读取） |
| `test_unsupported_format_reported` | OCR/PPT 显式报 `unsupported_format`，不假装支持 |
| `test_chat_stream_contract_with_chunks` / `test_chat_stream_server_side_retrieve` / `test_chat_stream_empty_kb` | SSE 帧序与载荷契约（含空库与 BFF 传入 chunks 两种模式） |

## 四、契约精化（相对手册阶段 1 原文）

1. **SSE 线上格式**：现网事件并非 `event:` 帧，而是 `data:` 行内嵌 JSON `type` 字段（`sources`/`token`/`done`/`error`）。Python 按实际线上格式复刻，测试锁定。
2. **`/internal/index` 源类型扩展**：在手册 `url`（file:// 过渡 / http(s)）之外新增 `content`（内联文本）——text-like 文档免共享卷依赖，阶段 2 的对象存储改造不受影响。
3. **`/internal/chat/stream` 接受可选 `chunks`**：BFF 检索后先做 GraphRAG 重排、负反馈降权、私档过滤、联网合并（这些依赖 TS 侧会话/权限元数据），再把过滤后的权威 chunks 交给 Python 生成。缺省时 Python 自行检索。私档过滤保留在 BFF 是安全要求而非实现偏好。
4. **租户硬化提前**：手册放在阶段 3 的「chunk 带 workspace_id + 跨租户 0 hits + 缺失 400」本次一并落底（写入与检索路径，测试锁定），阶段 3 只剩 pgvector 后端与负例套件入 CI。

## 五、已知限制（不阻塞退出，演示时不得假装支持）

| 限制 | 说明 | 归属 |
|---|---|---|
| OCR / PPT 未迁移 | 上传即报 `unsupported_format`，文档标记 failed | 迭代 1b |
| pgvector 后端未接 | Python 侧为内存存储（演示模式）；重启即失，与 TS 演示模式一致 | 阶段 2/3 |
| parent-child 切片未移植 | `PARENT_CHILD_CHUNKING=true` 时远端路径退化为普通切片 | 阶段 2 |
| 多模态图片未透传 | 开关打开时 `images` 忽略（Python 演示生成无视觉通道） | 迭代 1b |
| Python 侧 LLM 需独立配置 | 本地验证 Python 走演示抽取式（未向 Python 进程注入 OPENAI_API_KEY）；compose 已透传 LLM 环境变量，生产配置两端一致即可 | 部署配置 |
| web 链接文档 | AI 服务模式下暂不支持（无可索引内容即 failed） | 阶段 2（对象存储/抓取器迁移时一并处理） |

## 六、回滚方式

- 关闭开关：`AI_SERVICE_URL` 置空（或删除该环境变量）→ 队列与 chat 全部回到进程内 TS RAG；已验证 e2e 全绿（A1.8）。
- AI 服务侧无状态（内存存储），停服即清；业务侧文档状态留在 TS/DB，重开开关后重新上传或重建索引即可。

## 七、建议的下一步（阶段 2 入口）

1. 对象存储：上传直传 MinIO/OSS，`/internal/index` 的 `source.type` 收敛为 `s3`/`presignedUrl`（2.1～2.6）；
2. Python 侧接入 pgvector（复用 compose 的 pgvector 实例），补 DNS 级 SSRF 复查与预签名 URL；
3. 负例套件入 CI（`services/ai/tests/` 随 quality job 运行）；
4. `.uploads` 共享卷从解析链路下线（文本类已走 content 内联，剩 binary 待 OSS）。
