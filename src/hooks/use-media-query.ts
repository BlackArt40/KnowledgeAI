"use client";
import * as React from "react";

/**
 * SSR-safe media query hook backed by useSyncExternalStore: returns `false`
 * during SSR, then the real value after hydration (no mismatch, no cascading
 * render from a sync setState in an effect).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = React.useCallback(() => false, []);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** True on phones / narrow viewports (below the md = 768px breakpoint). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
