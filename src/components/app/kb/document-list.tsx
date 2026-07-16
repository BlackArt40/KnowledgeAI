"use client";

import * as React from "react";
import { Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { DocTypeIcon } from "./doc-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatSize, formatRelative } from "@/lib/format";
import { STATUS_LABEL, type KbDocument, type DocStatus } from "@/lib/kb/types";

const IN_FLIGHT: DocStatus[] = ["queued", "parsing", "chunking", "vectorizing"];

function StatusBadge({ status }: { status: DocStatus }) {
  switch (status) {
    case "ready":
      return (
        <Badge variant="success">
          <CheckCircle2 className="h-3 w-3" /> 就绪
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3" /> 失败
        </Badge>
      );
    case "vectorizing":
      return (
        <Badge variant="default">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          向量化中
        </Badge>
      );
    case "parsing":
    case "chunking":
      return (
        <Badge variant="warning">
          <Loader2 className="h-3 w-3 animate-spin" /> {STATUS_LABEL[status]}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{STATUS_LABEL[status]}</Badge>;
  }
}

export function DocumentList({
  docs,
  onRefresh,
  onDelete,
}: {
  docs: KbDocument[];
  onRefresh: () => void;
  onDelete: (docId: string) => void;
}) {
  const hasInFlight = docs.some((d) => IN_FLIGHT.includes(d.status));

  React.useEffect(() => {
    if (!hasInFlight) return;
    const t = setInterval(onRefresh, 1200);
    return () => clearInterval(t);
  }, [hasInFlight, onRefresh]);

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <AlertCircle className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-medium">还没有文档</p>
        <p className="mt-1 text-xs text-muted-foreground">
          上传文件或添加网页链接，AI 将自动解析与向量化
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* header row */}
      <div className="hidden grid-cols-[1fr_120px_140px_120px_40px] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
        <span>文档</span>
        <span>大小 / 切片</span>
        <span>处理状态</span>
        <span>上传时间</span>
        <span />
      </div>

      <div className="divide-y divide-border">
        {docs.map((doc) => {
          const inFlight = IN_FLIGHT.includes(doc.status);
          return (
            <div
              key={doc.id}
              className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-accent/30 md:grid-cols-[1fr_120px_140px_120px_40px] md:items-center"
            >
              {/* name */}
              <div className="flex min-w-0 items-center gap-3">
                <DocTypeIcon type={doc.type} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.name}</p>
                  {inFlight ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress
                        value={doc.progress}
                        className="h-1.5 max-w-[180px]"
                        indicatorClassName="bg-brand-gradient"
                      />
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {doc.progress}%
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground md:hidden">
                      {doc.type === "web" ? "网页链接" : formatSize(doc.size)}
                    </p>
                  )}
                </div>
              </div>

              {/* size / chunks */}
              <div className="text-xs text-muted-foreground">
                <span className="md:hidden">大小: </span>
                {doc.type === "web" ? "网页链接" : formatSize(doc.size)}
                {doc.chunks > 0 && (
                  <span className="mt-0.5 block text-[11px]">{doc.chunks} 个切片</span>
                )}
              </div>

              {/* status */}
              <div>
                <StatusBadge status={doc.status} />
              </div>

              {/* time */}
              <div className="text-xs text-muted-foreground">
                {formatRelative(doc.uploadedAt)}
              </div>

              {/* actions */}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(doc.id)}
                  aria-label="删除文档"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
