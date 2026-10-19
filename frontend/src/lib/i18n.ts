// Vue 侧 i18n 胶水：全部走共享 i18next 单例（@shared/i18n/translate.ts），
// 语言包/插值配置零拷贝。locale 偏好逻辑镜像 Next 的 provider.tsx：
// localStorage("kai-locale") > cookie("kai-locale") > zh-CN；setLocale 同时
// 写 localStorage + cookie + <html lang>（预渲染脚本见 frontend/index.html）。
import { getI18nInstance, normalizeLocale, type Locale } from "@shared/i18n/translate";

export type { Locale };

export function readStoredLocale(): Locale {
  try {
    const saved = localStorage.getItem("kai-locale");
    if (saved) return normalizeLocale(saved);
    const m = document.cookie.match(/(?:^|;\s*)kai-locale=([^;]+)/);
    if (m) return normalizeLocale(decodeURIComponent(m[1]));
  } catch {
    /* 隐私模式等存储不可用场景，回退默认 */
  }
  return "zh-CN";
}

export function applyLocale(locale: Locale): void {
  void getI18nInstance().changeLanguage(locale);
  try {
    localStorage.setItem("kai-locale", locale);
  } catch {
    /* ignore */
  }
  document.cookie = `kai-locale=${locale}; path=/; max-age=31536000`;
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}

/** 启动时调用一次：把共享实例切到已存偏好（changeLanguage 不影响 Next 运行时）。 */
export function initLocale(): Locale {
  const locale = readStoredLocale();
  void getI18nInstance().changeLanguage(locale);
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  return locale;
}
