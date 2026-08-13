"use client";
// P5-4: LocaleProvider + useI18n/useT/useLocale hooks.
// Initial locale comes from the server (cookie, passed as `serverLocale` by
// the root layout) so SSR output matches the user's choice (no flash); after
// hydration a localStorage preference (if any) wins. `setLocale` writes
// localStorage + the `kai-locale` cookie (server negotiation) and updates
// <html lang> - the UI re-renders immediately without a page reload.
import * as React from "react";
import { normalizeLocale, getI18nInstance, type Locale } from "./translate";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function LocaleProvider({
  serverLocale,
  children,
}: {
  serverLocale?: string | null;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(() => normalizeLocale(serverLocale));

  // Hydration: prefer the localStorage preference over the server cookie.
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("kai-locale");
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration sync is the point of this effect
        setLocaleState(normalizeLocale(saved));
      }
    } catch { /* private mode */ }
  }, []);

  // getFixedT(locale) is cheap and stateless on the shared instance -
  // language switching is a plain re-render, no async changeLanguage needed.
  const t = React.useMemo(
    () => getI18nInstance().getFixedT(locale) as (key: string, vars?: Record<string, string | number>) => string,
    [locale]
  );

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem("kai-locale", l); } catch { /* private mode */ }
    document.cookie = `kai-locale=${l}; path=/; max-age=31536000`;
    document.documentElement.lang = l === "en" ? "en" : "zh-CN";
  }, []);

  const value = React.useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LocaleProvider");
  return ctx;
}

/** Translate hook: `const t = useT(); t("common.save")`. */
export function useT() {
  return useI18n().t;
}

/** Current locale ("zh-CN" | "en"). */
export function useLocale(): Locale {
  return useI18n().locale;
}
