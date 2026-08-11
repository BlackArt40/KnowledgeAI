// ---------------------------------------------------------------------------
// Theme engine (P5-5): three-mode theme (system / light / dark) + high
// contrast + transition animation.
//
// Storage keys (shared with the pre-hydration inline script in layout.tsx):
//   - `kai-theme`  -> "system" | "light" | "dark"  (missing = system)
//   - `kai-hc`     -> "1" when high contrast is on
// The `.dark` / `.high-contrast` classes live on <html>; the brand color is
// applied separately via CSS variables (see brand-colors.ts).
// All functions are SSR-safe (no-op without a DOM).
// ---------------------------------------------------------------------------

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "kai-theme";
const HC_KEY = "kai-hc";
const TRANSITION_CLASS = "theme-transition";
const TRANSITION_MS = 500;

export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" || t === "system" ? t : "system";
  } catch {
    return "system";
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable (private mode) - theme still applies this session */
  }
}

/** Does the OS currently prefer dark? */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve the effective mode: "system" follows the OS preference. */
export function resolveMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/** Add/remove the `theme-transition` class so colors animate during a switch. */
export function beginThemeTransition(): void {
  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);
  // One timer per switch; the class is purely cosmetic and can be dropped
  // early if a second switch starts (the new classList.add is a no-op).
  window.setTimeout(() => {
    document.documentElement.classList.remove(TRANSITION_CLASS);
  }, TRANSITION_MS);
}

/**
 * Apply a theme mode to <html> and persist it. With `animate`, colors
 * cross-fade for a moment instead of snapping (respects prefers-reduced-motion
 * via CSS - see the transition rule in globals.css).
 */
export function applyTheme(mode: ThemeMode, opts: { animate?: boolean; persist?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  if (opts.animate) beginThemeTransition();
  const dark = resolveMode(mode) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  if (opts.persist !== false) setStoredTheme(mode);
}

/** High contrast mode: `html.high-contrast` + persisted flag. */
export function getHighContrast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HC_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyHighContrast(on: boolean, opts: { persist?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("high-contrast", on);
  if (opts.persist !== false) {
    try {
      window.localStorage.setItem(HC_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to OS theme changes; only relevant while in "system" mode. */
export function subscribeSystemTheme(fn: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => fn();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
