// P5-4: i18n core backed by i18next (v26) - replaced the hand-rolled
// dotted-key resolver in 2026-08 (P7-5). Message packs (zh-CN.json / en.json)
// are loaded as i18next resources verbatim; keys keep the dotted-path
// convention and {var} interpolation (configured via custom prefix/suffix).
// Missing keys fall back to the key itself so gaps are visible during
// development - i18next's default behavior.
//
// escapeValue: false - React already escapes text nodes on render; escaping
// here would double-escape interpolated values.
import i18next, { type i18n } from "i18next";
import zh from "./messages/zh-CN.json";
import en from "./messages/en.json";

export type Locale = "zh-CN" | "en";

/** Coerce any input to a supported locale (default zh-CN). */
export function normalizeLocale(v: string | null | undefined): Locale {
  return v === "en" ? "en" : "zh-CN";
}

/** Build a configured i18next instance (synchronous - inline resources). */
function createInstance(): i18n {
  const inst = i18next.createInstance();
  const result = inst.init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    resources: {
      "zh-CN": { translation: zh as Record<string, unknown> },
      en: { translation: en as Record<string, unknown> },
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
  // initAsync:false makes initialization synchronous; a broken message pack
  // must fail loudly at boot (raw keys in the UI are the silent symptom).
  // The returned promise is still handled so a rejection can never become an
  // unhandled-rejection warning.
  if (result && typeof (result as { catch?: unknown }).catch === "function") {
    (result as Promise<unknown>).catch(() => undefined);
  }
  if (!inst.isInitialized) {
    throw new Error("i18next failed to initialize (message packs unreadable)");
  }
  return inst;
}

// Single shared instance: resources are static and getFixedT(locale) is
// stateless, so one instance serves both server (per-request locale) and
// client (locale switching via re-render).
const instance = createInstance();

/** The shared i18next instance (for provider bindings). */
export function getI18nInstance(): i18n {
  return instance;
}
