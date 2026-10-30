// 知识库头像底色：KB.color 来自 Next 版 Tailwind 类名片段（如 "from-primary/15"），
// 直接写进 inline background 是非法值 → 白字落在透明底上（列表/详情头像消失）。
// 这里只接受合法的颜色字面量，其余按名称哈希落到固定渐变调色板。
// 渐变两端取自分类色板（lib/palette.ts），不再单独维护 hex。
import { TINTS } from "./palette";

const PALETTE: [string, string][] = [
  [TINTS.indigo, TINTS.violet],
  [TINTS.sky, TINTS.indigo],
  [TINTS.emerald, TINTS.sky],
  [TINTS.amber, TINTS.rose],
  [TINTS.violet, TINTS.fuchsia],
  [TINTS.teal, TINTS.skyText],
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
