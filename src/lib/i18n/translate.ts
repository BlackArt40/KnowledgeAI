// P5-4: i18n core backed by i18next (v26) - replaced the hand-rolled
// dotted-key resolver in 2026-08 (P7-5). Message packs (zh-CN.json / en.json)
// are loaded as i18next resources verbatim; keys keep the dotted-path
// convention and {var} interpolation (configured via custom prefix/suffix).
// Missing keys fall back to the key itself so gaps are visible during
// development - i18next's default behavior.
//
// escapeValue: false - React already escapes text nodes on render; escaping
// here would double-escape interpolated values.
import i18next, { type i18n, type TFunction } from "i18next";
import zh from "./messages/zh-CN.json";
import en from "./messages/en.json";

export type Messages = Record<string, unknown>;
export const MESSAGES: Record<string, Messages> = {
  "zh-CN": zh as Messages,
  en: en as Messages,
};

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Coerce any input to a supported locale (default zh-CN). */
export function normalizeLocale(v: string | null | undefined): Locale {
  return v === "en" ? "en" : "zh-CN";
}

/** Build a configured i18next instance (synchronous - inline resources). */
function createInstance(): i18n {
  const inst = i18next.createInstance();
  void inst.init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    resources: {
      "zh-CN": { translation: zh as Messages },
      en: { translation: en as Messages },
    },
    // Message packs use single-brace {var}; `{{ $json.question }}` in the
    // n8n templates must survive untouched (missing vars keep their
    // placeholder - matches the old resolver).
    interpolation: { prefix: "{", suffix: "}", escapeValue: false },
    keySeparator: ".",
    nsSeparator: false,
    returnNull: false,
    initAsync: false, // sync init - inline resources, t usable immediately
  });
  return inst;
}

// Single shared instance: resources are static and getFixedT(locale) is
// stateless, so one instance serves both server (per-request locale) and
// client (locale switching via re-render).
const instance = createInstance();

/** t bound to a fixed locale (server-side / non-React code). */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return instance.getFixedT(locale)(key, vars);
}

/** The shared i18next instance (for provider bindings). */
export function getI18nInstance(): i18n {
  return instance;
}

export type { TFunction };
