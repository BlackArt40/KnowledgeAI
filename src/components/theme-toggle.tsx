"use client";

import { useT } from "@/lib/i18n/provider";
import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyTheme,
  getStoredTheme,
  subscribeSystemTheme,
  type ThemeMode,
} from "@/lib/theme/mode";

// P5-5: three-mode toggle (light / dark / system). The button shows the
// current mode's icon and opens a small dropdown; selecting a mode applies it
// with a cross-fade and persists it to `kai-theme`. While in "system" mode a
// matchMedia listener keeps the page in sync with the OS preference.
const MODE_ICON: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "page.theme-toggle.s1",
  dark: "page.theme-toggle.s2",
  system: "page.theme-toggle.s3",
};

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const [mounted, setMounted] = React.useState(false);
  const [mode, setMode] = React.useState<ThemeMode>("system");
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setMode(getStoredTheme());
    // While in system mode, follow OS theme changes without a reload.
    return subscribeSystemTheme(() => {
      if (getStoredTheme() === "system") applyTheme("system", { persist: false });
    });
  }, []);

  // Close the dropdown on outside click / Escape (same pattern as the
  // language switcher in the AppShell header).
  React.useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function select(next: ThemeMode) {
    setMode(next);
    applyTheme(next, { animate: true });
    setOpen(false);
  }

  const Icon = MODE_ICON[mode];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t("page.theme-toggle.s0")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          className
        )}
      >
        {mounted ? <Icon className="h-4 w-4" /> : <Sun className="h-4 w-4 opacity-0" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-36 rounded-xl border border-border bg-card p-1 shadow-xl">
          {(["light", "dark", "system"] as ThemeMode[]).map((m) => {
            const MIcon = MODE_ICON[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => select(m)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
                  mode === m && "bg-primary/10 text-primary"
                )}
              >
                <MIcon className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t(MODE_LABEL[m])}</span>
                {mode === m && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
