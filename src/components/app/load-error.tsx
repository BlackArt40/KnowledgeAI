"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";

/** 页面数据加载失败时的内联回退（替代无限骨架屏）。
 *  配合 fetchJson 使用：数据请求失败 → 不再把错误体写进 state，而是渲染这个
 *  提示 + 重试入口。caller 负责外层容器宽度。 */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
    >
      <TriangleAlert className="mx-auto h-5 w-5 text-destructive" />
      <p className="mt-3 text-sm font-medium text-destructive">{t("common.requestFailed")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("common.networkError")}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
