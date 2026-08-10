"use client";
// P5-1 touch gestures. Handlers attach native (non-passive where needed)
// listeners so they work on touch devices; all hooks are SSR-safe no-ops
// until mounted.
import * as React from "react";

/**
 * Edge swipe: a touch that starts within `edge` px of the left screen edge
 * and swipes right past `threshold` px fires `onOpen` (mobile drawer).
 */
export function useEdgeSwipe(
  onOpen: () => void,
  opts?: { enabled?: boolean; edge?: number; threshold?: number }
) {
  const enabled = opts?.enabled ?? true;
  const edge = opts?.edge ?? 24;
  const threshold = opts?.threshold ?? 60;
  const onOpenRef = React.useRef(onOpen);
  React.useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  React.useEffect(() => {
    if (!enabled) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      active = startX <= edge;
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx > threshold && dx > Math.abs(dy)) onOpenRef.current();
      active = false;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [enabled, edge, threshold]);
}

/**
 * Horizontal swipe on an element: fires `onSwipe("left" | "right")` when the
 * touch travels past `threshold` px horizontally while staying mostly
 * horizontal (|dx| > 1.5 × |dy|) so vertical scrolling wins.
 */
export function useHorizontalSwipe(
  elRef: React.RefObject<HTMLElement | null>,
  onSwipe: (dir: "left" | "right") => void,
  opts?: { enabled?: boolean; threshold?: number }
) {
  const enabled = opts?.enabled ?? true;
  const threshold = opts?.threshold ?? 60;
  const onSwipeRef = React.useRef(onSwipe);
  React.useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  React.useEffect(() => {
    const el = elRef.current;
    if (!enabled || !el) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      active = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onSwipeRef.current(dx > 0 ? "right" : "left");
      }
      active = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [enabled, threshold, elRef]);
}

/**
 * Long press: fires `onLongPress` after holding `duration` ms without moving
 * more than `moveCancel` px. Uses non-passive listeners so it can prevent
 * the browser's default long-press behavior (text selection / context menu)
 * and the follow-up click.
 */
export function useLongPress(
  elRef: React.RefObject<HTMLElement | null>,
  onLongPress: (e: { clientX: number; clientY: number }) => void,
  opts?: { enabled?: boolean; duration?: number; moveCancel?: number }
) {
  const enabled = opts?.enabled ?? true;
  const duration = opts?.duration ?? 500;
  const moveCancel = opts?.moveCancel ?? 10;
  const onLongPressRef = React.useRef(onLongPress);
  React.useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  React.useEffect(() => {
    const el = elRef.current;
    if (!enabled || !el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let fired = false;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      fired = false;
      clear();
      timer = setTimeout(() => {
        fired = true;
        onLongPressRef.current({ clientX: startX, clientY: startY });
      }, duration);
    };
    const onMove = (e: TouchEvent) => {
      if (!timer) return;
      const t = e.touches[0];
      if (!t) return;
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > moveCancel) clear();
    };
    // Prevent the synthetic click after a long press and suppress the
    // browser's native context menu so the app menu is the only one.
    const onClick = (e: MouseEvent) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    };
    const onContext = (e: Event) => {
      if (fired) e.preventDefault();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", clear, { passive: true });
    el.addEventListener("touchcancel", clear, { passive: true });
    el.addEventListener("click", onClick, { passive: false });
    el.addEventListener("contextmenu", onContext, { passive: false });
    return () => {
      clear();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", clear);
      el.removeEventListener("touchcancel", clear);
      el.removeEventListener("click", onClick);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [enabled, duration, moveCancel, elRef]);
}
