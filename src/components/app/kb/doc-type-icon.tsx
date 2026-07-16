import { FileText, FileType2, FileCode, Link2, FileSpreadsheet, FileImage, File } from "lucide-react";
import type { DocType } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

const map: Record<DocType, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  pdf: { icon: FileText, cls: "bg-destructive/12 text-destructive" },
  word: { icon: FileType2, cls: "bg-sky-500/12 text-sky-500" },
  markdown: { icon: FileCode, cls: "bg-emerald-500/12 text-emerald-500" },
  text: { icon: FileText, cls: "bg-muted text-muted-foreground" },
  web: { icon: Link2, cls: "bg-violet-500/12 text-violet-500" },
  csv: { icon: FileSpreadsheet, cls: "bg-amber-500/12 text-amber-500" },
  image: { icon: FileImage, cls: "bg-pink-500/12 text-pink-500" },
  other: { icon: File, cls: "bg-muted text-muted-foreground" },
};

export function DocTypeIcon({ type, className }: { type: DocType; className?: string }) {
  const { icon: Icon, cls } = map[type] ?? map.other;
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg",
        cls,
        className
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}
