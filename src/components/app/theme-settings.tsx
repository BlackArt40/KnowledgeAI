"use client";

import * as React from "react";
import { Check, Contrast, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  applyHighContrast,
  applyTheme,
  getHighContrast,
  getStoredTheme,
  type ThemeMode,
} from "@/lib/theme/mode";
import {
  applyBrandColor,
  BRAND_COLORS,
  DEFAULT_BRAND_COLOR,
} from "@/lib/theme/brand-colors";

const MODE_OPTIONS: { mode: ThemeMode; icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
  { mode: "light", icon: Sun, labelKey: "page.theme-settings.modeLight" },
  { mode: "dark", icon: Moon, labelKey: "page.theme-settings.modeDark" },
  { mode: "system", icon: Monitor, labelKey: "page.theme-settings.modeSystem" },
];

// P5-5: 外观 tab - theme mode (system/light/dark) + high contrast (WCAG AA)
// + workspace brand color. Theme & contrast are per-device (localStorage,
// same keys as the ThemeToggle / pre-hydration script); the brand color is
// workspace-level and persisted server-side (owner-only).
export function ThemeSettings() {
  const t = useT();
  const [mounted, setMounted] = React.useState(false);
  const [mode, setMode] = React.useState<ThemeMode>("system");
  const [hc, setHc] = React.useState(false);
  const [brand, setBrand] = React.useState(DEFAULT_BRAND_COLOR);
  const [isOwner, setIsOwner] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setMode(getStoredTheme());
    setHc(getHighContrast());
    // Current workspace brand color + ownership (drives the picker).
    fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const cur = d.workspaces?.find((w: { id: string }) => w.id === d.currentWorkspace);
        if (cur) {
          setBrand(cur.brandColor ?? DEFAULT_BRAND_COLOR);
          setIsOwner(!!cur.isOwner);
        }
      })
      .catch(() => {});
  }, []);

  function selectMode(m: ThemeMode) {
    setMode(m);
    applyTheme(m, { animate: true });
  }

  function toggleHc(on: boolean) {
    setHc(on);
    applyHighContrast(on);
  }

  async function selectBrand(id: string) {
    if (!isOwner || id === brand) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandColor: id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: d.error || t("page.theme-settings.saveError") });
        return;
      }
      setBrand(id);
      applyBrandColor(id);
      setMsg({ ok: true, text: t("page.theme-settings.saveOk") });
    } catch {
      setMsg({ ok: false, text: t("page.theme-settings.saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Theme mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {t("page.theme-settings.modeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("page.theme-settings.modeHint")}</p>
          <div className="grid grid-cols-3 gap-2">
            {MODE_OPTIONS.map(({ mode: m, icon: MIcon, labelKey }) => (
              <button
                key={m}
                type="button"
                onClick={() => selectMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                  mode === m
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <MIcon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* High contrast */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Contrast className="h-4 w-4" />
              {t("page.theme-settings.hcTitle")}
            </span>
            <Switch checked={hc} onCheckedChange={toggleHc} disabled={!mounted} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("page.theme-settings.hcHint")}</p>
        </CardContent>
      </Card>

      {/* Brand color (workspace level) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t("page.theme-settings.brandTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("page.theme-settings.brandHint")}</p>
          <div className="flex flex-wrap items-center gap-2.5">
            {BRAND_COLORS.map((c) => {
              const active = brand === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!isOwner || saving}
                  onClick={() => void selectBrand(c.id)}
                  aria-label={t(c.labelKey)}
                  aria-pressed={active}
                  title={t(c.labelKey)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full transition-transform",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isOwner && !saving ? "hover:scale-110 cursor-pointer" : "cursor-not-allowed opacity-60"
                  )}
                  style={{ backgroundColor: c.swatch }}
                >
                  {active && <Check className="h-4 w-4 text-white" />}
                </button>
              );
            })}
          </div>
          {!isOwner && (
            <p className="text-xs text-muted-foreground">{t("page.theme-settings.brandOwnerOnly")}</p>
          )}
          {msg && (
            <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
