// P5-4: server-side locale resolution + translation for server components
// and metadata. Locale order: `kai-locale` cookie -> Accept-Language -> zh-CN.
import { cookies, headers } from "next/headers";
import { normalizeLocale, getI18nInstance, type Locale } from "./translate";

export async function getLocaleFromCookies(): Promise<Locale> {
  try {
    const c = (await cookies()).get("kai-locale")?.value;
    if (c) return normalizeLocale(c);
    const al = (await headers()).get("accept-language") ?? "";
    if (/^\s*en\b/i.test(al)) return "en";
  } catch { /* outside request scope */ }
  return "zh-CN";
}

/** Server-side translate: `const { locale, t } = await serverT();` */
export async function serverT() {
  const locale = await getLocaleFromCookies();
  return {
    locale,
    t: getI18nInstance().getFixedT(locale),
  };
}
