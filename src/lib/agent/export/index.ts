// ---------------------------------------------------------------------------
// Report export entry point (criterion #1: 4 export formats).
//
//   md      -> Markdown text (task.report as-is)
//   pdf     -> self-contained print HTML (browser "Save as PDF")
//   pptx    -> OOXML presentation (zip package)
//   mindmap -> OPML outline (Xmind-importable)
// ---------------------------------------------------------------------------

import type { AgentTask, ExportFormat } from "../types";
import { renderPrintHtml } from "./pdf-print";
import { markdownToOpml } from "./opml";
import { generatePptx } from "./pptx";

export interface ExportResult {
  content: string | Uint8Array;
  contentType: string;
  filename: string;
}

/** Sanitize a topic into a filesystem-safe base filename. */
function safeName(topic: string): string {
  return (topic || "report").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

/** Export a task's report in the requested format. */
export function exportReport(task: AgentTask, format: ExportFormat): ExportResult {
  const base = safeName(task.topic);
  switch (format) {
    case "md":
      return { content: task.report ?? "", contentType: "text/markdown; charset=utf-8", filename: `${base}.md` };
    case "mindmap":
      return { content: markdownToOpml(task.report ?? "", task.topic), contentType: "application/xml; charset=utf-8", filename: `${base}.opml` };
    case "pdf":
      return { content: renderPrintHtml(task), contentType: "text/html; charset=utf-8", filename: `${base}.html` };
    case "pptx": {
      const bytes = generatePptx(task);
      return { content: bytes, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", filename: `${base}.pptx` };
    }
  }
}
