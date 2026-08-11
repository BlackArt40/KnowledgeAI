"use client";
// P5-4: format helpers bound to the current locale (use inside components).
import { useI18n } from "./provider";
import {
  formatRelative,
  formatDate,
  formatDateTime,
  formatNumber,
  formatSize,
} from "@/lib/format";

export function useFormat() {
  const { locale } = useI18n();
  return {
    formatRelative: (ts: number) => formatRelative(ts, locale),
    formatDate: (ts: number) => formatDate(ts, locale),
    formatDateTime: (ts: number) => formatDateTime(ts, locale),
    formatNumber: (n: number) => formatNumber(n, locale),
    formatSize: (b: number) => formatSize(b, locale),
  };
}
