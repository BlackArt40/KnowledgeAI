"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { Trash2, Loader2, CheckCircle2, AlertCircle, Share2 } from "lucide-react";
import { DocTypeIcon } from "./doc-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSize, formatRelative } from "@/lib/format";
import { STATUS_LABEL, type KbDocument, type DocStatus } from "@/lib/kb/types";
import { DOC_ACCESS_LABEL, type DocAccess } from "@/lib/team/types";

const IN_FLIGHT: DocStatus[] = ["queued", "parsing", "chunking", "vectorizing"];

function StatusBadge({ status }: { status: DocStatus }) {
  const t = useT();
  switch (status) {
    case "ready":
      return (
        <Badge variant="success">
          <CheckCircle2 className="h-3 w-3" /> {t("page.document-list.s11")}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3" /> {t("page.document-list.s12")}
        </Badge>
      );
    case "vectorizing":
      return (
        <Badge variant="default">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {t("page.document-list.s13")}
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
  onShare,
}: {
  docs: KbDocument[];
  onRefresh: () => void;
  onDelete: (docId: string) => void;
  /** P4-2: open the share-link dialog for a document. */
  onShare: (doc: KbDocument) => void;
}) {
  const t = useT();
  const hasInFlight = docs.some((d) => IN_FLIGHT.includes(d.status));

  React.useEffect(() => {
    if (!hasInFlight) return;
    const t = setInterval(onRefresh, 1200);
    return () => clearInterval(t);
  }, [hasInFlight, onRefresh]);

  // P4-2: set a document's access override (null = inherit KB access).
  async function changeAccess(doc: KbDocument, value: string) {
    await fetch(`/api/knowledge-base/${doc.kbId}/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: value === "inherit" ? null : value }),
    });
    onRefresh();
  }

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <AlertCircle className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-medium">{t("page.document-list.s0")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("page.document-list.s14")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* header row */}
      <div className="hidden grid-cols-[1fr_120px_140px_120px_40px] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
        <span>{t("page.document-list.s1")}</span>
        <span>{t("page.document-list.s2")}</span>
        <span>{t("page.document-list.s3")}</span>
        <span>{t("page.document-list.s4")}</span>
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
                      {doc.type === "web" ? t("page.document-list.s7") : formatSize(doc.size)}
                    </p>
                  )}
                  {/* P4-2: document-level access override (inherit / view / edit / private) */}
                  <div className="mt-1.5">
                    <Select
                      value={doc.access ?? "inherit"}
                      onValueChange={(v) => changeAccess(doc, v)}
                    >
                      <SelectTrigger className="h-6 w-[110px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">{t("page.document-list.s5")}</SelectItem>
                        {(Object.keys(DOC_ACCESS_LABEL) as DocAccess[]).map((a) => (
                          <SelectItem key={a} value={a}>{DOC_ACCESS_LABEL[a]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* size / chunks */}
              <div className="text-xs text-muted-foreground">
                <span className="md:hidden">{t("page.document-list.s5")} </span>
                {doc.type === "web" ? t("page.document-list.s7") : formatSize(doc.size)}
                {doc.chunks > 0 && (
                  <span className="mt-0.5 block text-[11px]">{t("page.document-list.s15", { count: doc.chunks })}</span>
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
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  onClick={() => onShare(doc)}
                  aria-label={t("page.document-list.s8")}
                  title={t("page.document-list.s9")}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(doc.id)}
                  aria-label={t("page.document-list.s10")}
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
