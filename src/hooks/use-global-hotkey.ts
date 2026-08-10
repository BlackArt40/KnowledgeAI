"use client";
// P5-2: global keyboard shortcut (Cmd/Ctrl+K) to open the search panel.
// SSR-safe: no listeners are attached until mounted, following the same
// ref-callback pattern as use-gestures.
import * as React from "react";

export function useGlobalHotkey(
  combo: "cmd-k",
  onTrigger: () => void,
  opts?: { enabled?: boolean }
) {
  const enabled = opts?.enabled ?? true;
  const onTriggerRef = React.useRef(onTrigger);
  React.useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (combo === "cmd-k") {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === "k" || e.key === "K")) {
          e.preventDefault();
          onTriggerRef.current();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, combo]);
}
