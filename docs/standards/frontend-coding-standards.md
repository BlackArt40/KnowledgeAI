---
title: 前端编码规范（Vue 3 · Element Plus · Vite）
description: frontend/ 的共享资产单源、样式分层、令牌纪律、i18n、列表 key 与验证命令，供代码评审与新增页面时逐条对照
type: reference
category: standards
level: L1
version: 1.3.0
authors:
  - frontend
owner: 前端负责人
reviewed_at: 2026-10-29
review_interval: 180
status: published
applies_to: ">=1.4.0"
---

# 前端编码规范（Vue 3 · Element Plus · Vite）

适用 `frontend/src/**` 与 `src/lib/**` 中被 `@shared` 引用的共享模块。Next 侧只剩 `/api/**` 与最小根 layout，后端规范见 `docs/architecture/` 其余文档。

本规范是**代码评审 Standards 轴的依据**：评审 diff 时，违反下列任一条即为硬违规；规范未覆盖之处才回退到通用坏味道基线。

## 1. 共享资产单源，禁止拷贝

以下能力已存在 `src/lib`，经 `@shared` alias 引用（`frontend/vite.config` 与 tsconfig 均已配置）：

| 能力 | 单源位置 | 典型引用 |
|------|----------|----------|
| i18n 语言包与实例 | `src/lib/i18n/messages/*`、`src/lib/i18n` | `@shared/i18n/translate` |
| SSE 事件解析 | `src/lib/sse.ts` | `@shared/sse` |
| 主题引擎 | `src/lib/theme/` | `@shared/theme/*` |
| 格式化（数字 / 日期 / 字节） | `src/lib/format.ts` | `@shared/format` |
| 语音 STT / TTS | `src/lib/voice/{stt,tts}.ts` | `@shared/voice/*` |
| 计费套餐与类型 | `src/lib/billing/` | `@shared/billing/*` |
| Agent 类型与模板 | `src/lib/agent/` | `@shared/agent/*` |
| 营销就绪态归一 | `src/lib/marketing/readiness.ts` | `@shared/marketing/readiness` |

在 `frontend/src` 里复制一份同类实现（哪怕是「先用着」的临时版）视为违规；缺能力时先看 `src/lib` 是否已有，没有再新增到 `src/lib` 并由前端引用。

## 2. 样式分层（五层，顺序固定）

`frontend/src/main.ts` 按此顺序引入，**改动顺序会改变级联结果**：

| 层 | 文件 | 只允许放 | 禁止 |
|----|------|----------|------|
| 1 令牌 | `styles/tokens.css` | CSS 变量定义（`:root` / `.dark` / 高对比度块） | 元素选择器、工具类、`::selection` 之类全局基线 |
| 2 基线 | `styles/base.css` | 元素级重置与全局基线（盒模型、`body` 排版、`::selection`、全局焦点环、`prefers-reduced-motion`） | 令牌定义、业务类 |
| 3 EP 适配 | `styles/element-adapter.css` | `.el-*` 变量映射与 `html.dark` 下的覆盖（必须晚于 EP 的 css-vars） | 页面级样式 |
| 4 滚动条 | `styles/scrollbar.css` | `.kai-scroll` 细滚动条 | — |
| 5 工具类 | `styles/utility.css` | 可复用类与 `@keyframes`：`.card` / `.card-body` / `.card-head.between` / `.badge`(+`.ok/.warn/.err`) / `.hint` / `.sub` / `.sk` / `.empty` / `.btn`(+`.outline`) / `.form-error` | 页面专属样式 |

规则：

- 新页面**直接复用**上表工具类，不要在页面 scoped 块里重抄一遍；页面差异（内边距 / 圆角 / 字号 / 配色）写成覆盖规则即可——scoped 选择器权重更高，天然生效。
- 唯一提权例外：状态徽章变体写 `.badge[class].warn`，否则会被页面里残留的 scoped `.badge` 配色压掉（同权重且后注入）。
- 令牌与工具类之间的灰色地带（只在两个页面出现的同形小件）先放页面内；出现第三处时抽到 `utility.css`。

## 3. 令牌纪律

- **颜色分三类**（2026-10-29 校准，此前写成「一律不得写字面量」，与 `#fff` 结构性用法冲突）：
  1. **语义色必须走令牌**。注意分两组：随主题翻转的（`--background` / `--foreground` / `--primary` / `--success` / `--warning` / `--destructive` 等在 `.dark` 有覆盖），和不随主题翻转的固定状态色（`--positive` / `--positive-text` / `--positive-strong` / `--negative` / `--negative-strong` / `--warning-bright` / `--warning-text`，以及 `--surface-inverse*` / `*-on-inverse` 组，只在 `:root` 定义）。**不要把固定状态色映射到会翻转的令牌上**，那会在暗色主题下变色。
  2. **结构性中性值允许字面量**：`#fff`、`#000`、`rgb(255 255 255 / α)` 这类纯白/纯黑叠加，以及 `element-adapter.css` 里 `color-mix(… , #fff)` 的混合锚点。
  3. **数据侧色值豁免**：SVG `fill` 属性、组件 `color` prop 的数据源（`KbGraphView` 的 `TYPE_COLORS`、`KbListView` 的 `COLORS` 选色板）是**数据**而非 CSS，保留 hex。
- 待收敛：装饰色板仍散落 Tailwind 色值（`#10b981` 翠绿 / `#8b5cf6` 紫 / `#0ea5e9` 天蓝 / `#14b8a6` 青 / `#ec4899` 粉 / `#d946ef` 洋红 / `#f97316` 橙 / `#f43f5e` 玫瑰 / `#6366f1` 靛蓝），用于图标 tint 与图表，语义未定，等设计给出正式色板后再令牌化；新代码不要扩大这批值。
- **圆角三分法**（2026-10-29 校准：此前「圆角一律不得写字面量」的写法与仓库现状冲突——现存 299 处字面量，其中 68 处是本条要豁免的小件——故作废重写）：
  1. **阶梯值必须走令牌**：8 / 12 / 14 / 16 / 20 / 24px 对应 `--radius-sm` / `--radius` / `--radius-card` / `--radius-lg` / `--radius-xl` / `--radius-2xl`。新代码写字面量即违规。
  2. **胶囊用 `--radius-full`**（9999px 的语义名），不再写字面量。
  3. **登记例外可以写字面量**，但**不得新增集合以外的值**，确需新值先改登记表。当前登记值：
     - 卡内小件：`4` / `6` / `7` / `9` / `10` / `11` / `13px`（chip、tile、进度条、气泡尾巴等紧值，刻意不参与阶梯）
     - 大件装饰：`28px`（演示台外壳 `.console`）、`40px`（hero 光晕 `.demo-glow`）——不属阶梯、也非胶囊，改动需同步 `design-system.md`
- 阶梯语义：`--radius` 0.75rem 是 EP 控件基线（`element-adapter.css` 依赖它，改它会让按钮 / 输入 / 下拉 / 弹窗一起变圆）；`--radius-card` 0.875rem 只给 `.card`；`--radius-lg` / `--radius-xl` / `--radius-2xl` 给内容容器。
- 存量已于 2026-10-29 清零：阶梯值 152 处、胶囊 63 处全部令牌化，`frontend/src` 内不再有阶梯/胶囊字面量。此后新代码写字面量即违规，评审可直接打回。
- 反面色面（营销 CTA、定价主推卡、认证页品牌面板）两套主题下都是深底，因此 `--surface-inverse` / `--surface-inverse-deep` / `--primary-on-inverse` / `--success-on-inverse` / `--border-on-inverse` **只在 `:root` 定义**，不要在 `.dark` 里再覆盖一次。
- 顶栏高度只能读 `--topbar-h`（`.topbar`、`.side-head`、`chat-view.css` 的视口计算共用）。滚动锚点、导航栏高度同理，不要手抄像素值。

## 4. 文案与 i18n

- 所有用户可见文案走 `t()`，包括 `aria-label`、`placeholder`、按钮标题，以及 `2FA` / `RBAC` / `GDPR` 这类缩写。
- 中英语言包必须成对新增；**zh 与 en 的值不得相同**（`scripts/smoke/test-i18n-coverage.ts` 会判失败，仅 `common.chinese` / `common.english` / `page.settings.s7` 豁免）。想在中文界面保留缩写时，中文侧应给出本地化表述。
- 不要在组件里拼语言包键名跨页面复用（例如营销页去读 `page.dashboard.*`）——改一处会串改另一处；确需共用时在语言包里新增语义化键。

## 5. 列表渲染的 key

- 数据列表用稳定标识（`item.id`）；接口没给 id 时先补 id 字段，不要回退到文案或下标。
- 装饰性静态列表（固定几项、无状态）用 `index`。
- **禁止用翻译后的文案做 key**：切语言会整块重挂载。用 i18n 键路径本身（如 `:key="'page.features.s4'"`）是稳定的，但可读性差，优先 index。

## 6. 组件样式穿透

- 组件对外接口优先 props、variant 与 CSS 变量契约，其次才是 `:deep()`。
- `:deep()` 只允许两类场景，且必须在注释里写明原因：
  1. **第三方组件**（Element Plus 等）内部结构无法修改；
  2. **`v-html` 渲染出的内容**——这类 DOM 不在 Vue 组件作用域内，scoped 样式天然覆盖不到。`components/chat/MessageBubble.vue` 的 `.md :deep(h1)` 等规则属此列，是规范允许的形态。
- **单消费方组件的专属外观直接写进组件自身**，不要由父组件穿透覆盖。先例：`MktHero` 对 `KnowledgeConsole` / `LiveStatus` 的 8 条 `:deep()` 已收敛进两个组件（2026-10-29），组件注释里注明了「唯一消费方是 MktHero」。
- 若某处 `:deep()` 确实暂时无法收敛，评审时判为待收敛项并记录到 PR 描述；不要在一次改动里顺手重写子组件。

**渲染回归安全网**：改动组件的可见形态时，`frontend/e2e/home.spec.ts` 用 `toHaveCSS` 锁定了首页 hero 演示台与状态条的计算样式（圆角 / 阴影 / 内边距 / 尺寸 / 字号 / 布局）。纯样式重构应在改动前后各跑一次该用例——CI 没有视觉回归测试，它是唯一的「外观没变」证据。

## 7. 生成文件与手改边界

- `frontend/src/auto-imports.d.ts`、`frontend/src/components.d.ts` 由 unplugin 生成，`components.d.ts` 已不纳入版本控制；两者都不要手改，`vite build` 会重新生成。
- `frontend/public/` 下的 PWA 资产（`sw.js` / `manifest` / icons）由构建期 `copyPwaAssets` 从根 `public/` 拷入 `dist`，单源在根目录，不要在 frontend 里再放一份。

## 8. 新增页面的最小检查

1. 路由与视图放 `frontend/src/views/`，复用 `AppShell` / `AuthLayout`；
2. 文案进语言包双语，页面里只用 `t()`；
3. 样式优先用工具类，页面差异写成覆盖规则；颜色只读令牌；
4. `v-for` 的 key 按第 5 节处理；
5. 需要后端能力时确认 Next 侧 `/api/**` 已存在，不要把请求逻辑写进组件。

## 9. 验证命令

```bash
pnpm -C frontend typecheck        # vue-tsc
pnpm -C frontend lint             # eslint（独立 flat config）
pnpm -C frontend test             # vitest
pnpm -C frontend build            # 含 dist/home.html 预渲染
npx tsx scripts/smoke/test-i18n-coverage.ts   # 4/4 才通过
```

以上五项是 CI `frontend` job 与 `smoke` 的 lib 组实际执行的检查，提交前本地跑一遍即可对齐 CI。
