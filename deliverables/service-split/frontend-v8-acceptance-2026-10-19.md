# 前端 V8 验收文档（遗留清零：语音 STT/TTS 迁移 + graph-rag 检索质量）

- 日期：2026-10-19
- 阶段：前端替换 V8（承接 V7；V7 验收文档「遗留与后续」两项全部解决）
- 结论：**通过**（multimodal-ui 11/11 含恢复语音断言 + graph-rag 双形态 20/20·18/18 + 根 e2e 8/8 + frontend 全门禁 + i18n 4/4）

## 1. 范围与改动

### 1.1 语音 STT/TTS 迁移 Vue（V4 起后置的最大遗留）
- **单源复用**：`src/lib/voice/{stt,tts}.ts` 本就是框架无关可注入纯封装（V6 保留的 src/lib/**），经 `@shared/voice/*` 引用，零拷贝。无需移植 ambient types（lib.dom 已含 `speechSynthesis`，stt.ts 自带 window cast）。
- **新增** [use-speech.ts](file:///Users/wsy/Project/KnowledgeAI/frontend/src/lib/use-speech.ts)：`useSpeechRecognition`（supported/listening/interim/start/stop + 终稿回调，等价退役的 React hook；onBeforeUnmount 清理）与 `useSpeechSynthesis`（supported/speaking/speak/cancel，一次一路）。locale 经共享 i18next 实例在 start/speak 调用时实时读取（切语言无需重建组件）。
- **ChatView**：麦克风按钮（EP `Microphone` 图标；listening 时 destructive 色 + 呼吸脉冲动画；aria/title 走 `page.chat.s83/s84`）；中间转写实时拼接上屏（textarea `v-model` → `:value` + `@input`，listening 时显示 `input + ' ' + interim`，与 Next 版同语义）；终稿自动 `send(text)`。Web Speech 不支持的浏览器按钮按设计隐藏。
- **MessageBubble**：朗读按钮（EP `Reading` 图标；`page.chat.s85/s86`；`.on` 态高亮；一次一路、speak 前自动 cancel；朗读内容剥 `[n]` 引用标记；不支持的浏览器隐藏）。
- **i18n**：`page.chat.s83-86` 双语言包同步新增（zh：语音输入/停止语音输入/朗读回答/停止朗读；en：Voice input/Stop voice input/Read aloud/Stop reading），parity 保持。
- **test-multimodal-ui.mjs**：恢复 2 条语音断言——mic 按钮存在性（headless 无 SpeechRecognition 时反向断言「按设计隐藏」）、回答流式结束后操作行出现「朗读回答/Read aloud」（headless 无 speechSynthesis 时跳过）。**11/11**。

### 1.2 graph-rag 检索质量 2/20 根因修复（环境自适应断言）
- **根因**：非语料缺陷，是环境属性——「干扰项骗过 plain 基线」的前提只在**词面型嵌入**（demo/本地哈希，CI 形态）下成立；本地 dev 配置了真实嵌入（`.env.local` 的 `EMBEDDING_MODEL`），语义检索本就该把答案文档排前，plain 不被骗是嵌入质量更好。
- **修复**：test-graph-rag.ts 经 `GET /api/admin/config` 探测 embedding provider（`providers[].id === "embedding"` 的 `enabled`），真实嵌入时跳过 2 条前提依赖断言（「distractor ranks top-1」「precision@1: graphRag > plain」），保留 GraphRAG 自身正确性断言（top-1 命中答案集 + 干扰项沉底 + graphRag 完美）。CI demo 形态保持全量断言强度。
- **双形态实测**：demo 模式（CI 等价，`.env.local` 移出后重启 dev）**20/20 全量通过**——前提成立；真实嵌入 **18/18**（2 条按设计跳过，零失败）。

### 1.3 SettingsView lint warning 清理（V5 遗留）
- 移除未使用的 `const router = useRouter()`——frontend lint 归零（此前 0 errors + 1 warning）。

## 2. 门禁与测试结果

| 门禁 | 结果 |
| --- | --- |
| smoke multimodal-ui（语音断言恢复） | ✅ **11/11**（mic 存在 + 附件预览 + 图片问答 + 朗读按钮） |
| smoke graph-rag（demo/CI 形态） | ✅ **20/20 全量**（前提断言成立） |
| smoke graph-rag（真实嵌入形态） | ✅ **18/18**（2 条按设计跳过） |
| smoke graph-ui / theme-ui（demo 回归） | ✅ 13/13 · 38/38 |
| 根 e2e main-flow | ✅ **8/8** |
| frontend typecheck / lint / vitest | ✅ 全绿（lint 0 problems） |
| frontend build + prerender | ✅ |
| i18n 覆盖扫描 | ✅ 4/4（s83-86 parity + 无残留中文） |

## 3. 实测发现

1. **shell 残留 `CI=true`** 使根 playwright `reuseExistingServer:!CI` 失效，报「端口已被占用」——本地跑 e2e 需 `env -u CI`（已记 design log）。
2. 根 e2e Agent 用例在真实 LLM（首 token 80-100s）+ 刚重启 dev 下偶发 90s 超时，隔离复跑即过（非回归）。
3. headless Chrome（`--headless=new`）同时具备 SpeechRecognition 与 speechSynthesis，语音按钮正向断言可跑。
4. AGENTS.md 行内裸写 `[n]` 会被 markdown 解析为链接引用——需反引号包裹。

## 4. 遗留与后续

- V7 验收列出的两项遗留**全部解决**，无新增遗留。
- 已知非缺陷事项（记录在案，不需处理）：移动端横滑切换会话（V4 起后置的 UX 增强，非功能缺失）；preview 构建产物含本次语音 UI，`sw.js` VERSION 未 bump（语音资源走 `/assets/` SWR 缓存，无 precache 清单变化——下次部署统一 bump）。
- 回退：全部改动在 git 工作区未提交可整批 revert；语音为纯前端增量（新增 composable + 两个组件按钮 + 4 个 i18n 键），revert 不影响任何 API 契约。
