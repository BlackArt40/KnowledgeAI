// 知识库头像底色：KB.color 来自 Next 版 Tailwind 类名片段（如 "from-primary/15"），
// 直接写进 inline background 是非法值 → 白字落在透明底上（列表/详情头像消失）。
// 这里只接受合法的颜色字面量，其余按名称哈希落到固定渐变调色板。
const PALETTE: [string, string][] = [
  ["#6366f1", "#8b5cf6"],
  ["#0ea5e9", "#6366f1"],
  ["#10b981", "#0ea5e9"],
  ["#f59e0b", "#f43f5e"],
  ["#8b5cf6", "#d946ef"],
  ["#06b6d4", "#3b82f6"],
];

const VALID_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\(.+\))$/i;

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** 返回可直接用于 `background` 的合法 CSS 值。 */
export function kbAvatarBackground(color: string | null | undefined, seed: string): string {
  const raw = (color ?? "").trim();
  if (VALID_COLOR.test(raw)) return raw;
  const [from, to] = PALETTE[hash(seed || raw) % PALETTE.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
