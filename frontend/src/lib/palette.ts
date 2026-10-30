/**
 * 装饰 / 分类色板（categorical tints）——CSS 变量在数据侧的镜像。
 *
 * 为什么需要这份 hex：`styles/tokens.css` 的 `--tint-*` 只能用在 CSS 属性里，
 * 而下面两类场景拿不到 CSS 变量：
 *   1. SVG 的 `fill` 属性（presentation attribute 不解析 `var()`）；
 *   2. 会落进后端 / 数据库的选色值（知识库头像色，取回后仍要渲染）。
 *
 * 因此这里按同一套取值提供 hex，**与 `--tint-*` 一一对应**，改色时两边同步：
 * 语义与使用规则见 `docs/architecture/design-system.md` 的「装饰色板」一节。
 * 取值等同 Tailwind 500 档；tint 当文字用时取更深的 *-text 档（目前只有天蓝）。
 */
export const TINTS = {
  indigo: "#6366f1", // 知识库默认 / 人物实体
  sky: "#0ea5e9", // 组织实体 / 外部网页来源 / 共享 / RAG
  skyText: "#0284c7", // 天蓝系文字（白底 AA）
  emerald: "#10b981", // API / 文档 / 概念实体
  violet: "#8b5cf6", // Agent / LLM
  teal: "#14b8a6", // 团队 / 协作
  orange: "#f97316", // 用量 / 计费
  pink: "#ec4899", // 通知 / 消息
  rose: "#f43f5e", // 风险 / 告警类别
  fuchsia: "#d946ef", // 头像选色（无语义）
  amber: "#f59e0b", // 事件实体（状态语义见 --warning-bright）
} as const;

/** 知识库头像可选色（6 色，保证相邻色可区分） */
export const KB_COLORS = [
  TINTS.indigo,
  TINTS.emerald,
  TINTS.sky,
  TINTS.violet,
  TINTS.fuchsia,
  TINTS.rose,
] as const;

/** 知识图谱实体类型 → 节点色 */
export const ENTITY_COLORS: Record<string, string> = {
  person: TINTS.indigo,
  org: TINTS.sky,
  concept: TINTS.emerald,
  event: TINTS.amber,
};
