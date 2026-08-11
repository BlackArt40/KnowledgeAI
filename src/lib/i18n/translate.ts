// P5-4: lightweight i18n core - zero dependencies, hand-written (the project
// has no ICU/complex-plural needs; zh has no plural forms and en pluralizes
// simply). Message keys use dotted paths (e.g. "common.save"), values may
// contain {var} placeholders. Missing keys fall back to the key itself so
// gaps are visible during development.
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

/** Resolve `a.b.c` against the message tree; returns the key when missing. */
export function translate(
  messages: Messages,
  key: string,
  vars?: Record<string, string | number>
): string {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof cur !== "string") return key;
  if (vars) {
    return cur.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in vars ? String(vars[name]) : m
    );
  }
  return cur;
}

/** Translate in a specific locale (server-side / non-React code). */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return translate(MESSAGES[locale], key, vars);
}
