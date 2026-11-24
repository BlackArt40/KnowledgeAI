// ---------------------------------------------------------------------------
// Workspace brand colors (P5-5): a curated 6-color palette, each tuned so
// white-on-primary text clears WCAG AA (>= 4.5:1) in light mode and dark
// primary keeps the dark-mode convention (lighter + dark foreground).
//
// The gradient stops follow the original indigo pattern (hue +22 / +49).
// `getBrandCss()` is a pure function shared by the server ((app)/layout SSR
// injection) and the client (settings page instant apply).
// ---------------------------------------------------------------------------

export const DEFAULT_BRAND_COLOR = "indigo";

/** One palette entry: HSL channel triplets (no `hsl()` wrapper). */
interface BrandVars {
  primary: string;
  primaryForeground: string;
  ring: string;
  accent: string;
  accentForeground: string;
  brandFrom: string;
  brandVia: string;
  brandTo: string;
}

export interface BrandColorDef {
  id: string;
  /** i18n key for the color name (page.theme-settings.color*). */
  labelKey: string;
  /** Swatch preview hex (light primary). */
  swatch: string;
  light: BrandVars;
  dark: BrandVars;
  /** High-contrast variants: accent/accent-foreground pushed to AA. */
  hcLight: BrandVars;
  hcDark: BrandVars;
}

function h(n: number): number {
  return ((n % 360) + 360) % 360;
}

/** Build the per-mode variable block from base hue/sat/lightness. */
function vars(hue: number, sat: number, light: number, dark: boolean): BrandVars {
  const from = `${hue} ${sat}% ${light}%`;
  return {
    primary: from,
    primaryForeground: dark ? "240 12% 4%" : "0 0% 100%",
    ring: from,
    accent: dark ? `${hue} 40% 18%` : `${hue} 80% 97%`,
    accentForeground: dark ? `${hue} 80% 82%` : `${hue} 75% 40%`,
    brandFrom: from,
    brandVia: `${h(hue + 22)} ${dark ? sat + 2 : sat + 5}% ${dark ? light + 1 : light + 3}%`,
    brandTo: `${h(hue + 49)} ${dark ? sat : sat + 3}% ${dark ? light - 1 : light + 1}%`,
  };
}

/** High-contrast variant: keep the base brand values (white-on-primary
 *  already clears AA) and push the accent pair to AA (darker accent text on
 *  light, brighter on dark). */
function hcVars(hue: number, base: BrandVars, dark: boolean): BrandVars {
  return {
    ...base,
    accent: dark ? `${hue} 40% 26%` : `${hue} 80% 94%`,
    accentForeground: dark ? `${hue} 85% 88%` : `${hue} 75% 30%`,
  };
}

function def(id: string, labelKey: string, swatch: string, hue: number, sat: number, light: number, darkSat: number, darkLight: number): BrandColorDef {
  const l = vars(hue, sat, light, false);
  const d = vars(hue, darkSat, darkLight, true);
  return {
    id,
    labelKey,
    swatch,
    light: l,
    dark: d,
    hcLight: hcVars(hue, l, false),
    hcDark: hcVars(hue, d, true),
  };
}

// Light-mode lightness is chosen so white text on the primary clears AA
// (~4.5:1): indigo keeps its original 59%, other hues use 600/700-grade
// lightness. Dark mode follows the existing convention (brighter + dark fg).
export const BRAND_COLORS: BrandColorDef[] = [
  def("indigo", "page.theme-settings.colorIndigo", "#4f46e5", 243, 75, 59, 80, 67),
  def("emerald", "page.theme-settings.colorEmerald", "#047857", 158, 64, 33, 64, 45),
  def("sky", "page.theme-settings.colorSky", "#0369a1", 201, 94, 34, 94, 48),
  def("violet", "page.theme-settings.colorViolet", "#6d28d9", 262, 68, 50, 75, 62),
  def("fuchsia", "page.theme-settings.colorFuchsia", "#a21caf", 295, 72, 40, 72, 55),
  def("rose", "page.theme-settings.colorRose", "#be123c", 350, 89, 41, 89, 54),
];

export function getBrandColor(id: string): BrandColorDef {
  return BRAND_COLORS.find((c) => c.id === id) ?? BRAND_COLORS[0];
}

export function isValidBrandColor(id: string): boolean {
  return BRAND_COLORS.some((c) => c.id === id);
}

const BRAND_VAR_KEYS = [
  "primary",
  "primaryForeground",
  "ring",
  "accent",
  "accentForeground",
  "brandFrom",
  "brandVia",
  "brandTo",
] as const;

function block(selector: string, v: BrandVars): string {
  const rules = BRAND_VAR_KEYS.map((k) => `--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v[k]}`).join(";");
  return `${selector}{${rules}}`;
}

/**
 * Full CSS for a brand color: light + dark + high-contrast blocks. Injected
 * AFTER globals.css (server: <style> in (app)/layout; client: a #kai-brand
 * style tag) so it wins the cascade for the same specificity.
 */
export function getBrandCss(id: string): string {
  const c = getBrandColor(id);
  return [block(":root", c.light), block(".dark", c.dark), block(".high-contrast", c.hcLight), block(".high-contrast.dark", c.hcDark)].join("");
}

/** Client-side instant apply (after a PATCH succeeds - no reload). */
export function applyBrandColor(id: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById("kai-brand-style") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "kai-brand-style";
    document.head.appendChild(el);
  }
  el.textContent = getBrandCss(id);
}

/** Remove the injected style (back to the globals.css defaults). */
export function clearBrandColor(): void {
  if (typeof document === "undefined") return;
  document.getElementById("kai-brand-style")?.remove();
}
