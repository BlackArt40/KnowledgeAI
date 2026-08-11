// P5-4: locale-aware formatting helpers. `locale` is "zh-CN" | "en"
// (normalized via normalizeLocale). Components should use the useFormat()
// hook (src/lib/i18n/use-format.ts) which binds the current locale; plain
// callers (e.g. exportConversation) pass the locale explicitly.
import { normalizeLocale } from "@/lib/i18n/translate";

function intlLocale(locale: string): string {
  return normalizeLocale(locale) === "en" ? "en-US" : "zh-CN";
}

export function formatSize(bytes: number, locale: string = "zh-CN"): string {
  if (bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(ts: number, locale: string = "zh-CN"): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const en = normalizeLocale(locale) === "en";
  if (min < 1) return en ? "just now" : "刚刚";
  if (min < 60) return en ? `${min} min ago` : `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return en ? `${hr} hr ago` : `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return en ? `${day} days ago` : `${day} 天前`;
  const mon = Math.floor(day / 30);
  return en ? `${mon} months ago` : `${mon} 个月前`;
}

export function formatDate(ts: number, locale: string = "zh-CN"): string {
  return new Date(ts).toLocaleDateString(intlLocale(locale));
}

export function formatDateTime(ts: number, locale: string = "zh-CN"): string {
  return new Date(ts).toLocaleString(intlLocale(locale));
}

export function formatNumber(n: number, locale: string = "zh-CN"): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}
