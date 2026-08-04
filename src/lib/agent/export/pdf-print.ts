// ---------------------------------------------------------------------------
// Self-contained print HTML document for PDF export.
//
// Criterion #1: 报告导出为 PDF (保留格式 + 引用链接).
// The browser's native print pipeline renders Chinese perfectly (no font
// embedding needed) and "Save as PDF" produces the final file. Links in the
// report ([n] cites -> #cite-n, external source URLs) are clickable.
// ---------------------------------------------------------------------------

import { renderMarkdownToHtml, escapeHtml } from "./markdown-html";
import type { AgentTask } from "../types";

export function renderPrintHtml(task: AgentTask): string {
  const body = renderMarkdownToHtml(task.report ?? "");
  const fmtDate = new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false });
  const source = task.kbName ?? "公开检索";
  const duration = task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : "";

  const cites = (task.citations ?? []).map((c) => {
    const urlMatch = /(https?:\/\/[^\s]+)/.exec(c.source);
    const srcHtml = urlMatch
      ? `<a href="${escapeHtml(urlMatch[0])}" target="_blank" rel="noopener">${escapeHtml(c.source)}</a>`
      : escapeHtml(c.source);
    return `<li id="cite-${c.n}"><span class="cite-no">[${c.n}]</span> <strong>${escapeHtml(c.title)}</strong> — ${escapeHtml(c.snippet)} <span class="cite-src">${srcHtml}</span></li>`;
  }).join("\n");

  const citeSection = (task.citations?.length ?? 0) > 0
    ? `<section class="citations"><h2>引用来源</h2><ol>${cites}</ol></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(task.topic)}</title>
<style>
  :root { --fg:#1a1a1a; --muted:#666; --accent:#4f46e5; --border:#e5e7eb; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; color: var(--fg); max-width: 800px; margin: 0 auto; padding: 32px 24px; line-height: 1.7; font-size: 14px; }
  header.report-head { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 20px; }
  header.report-head h1 { font-size: 22px; margin: 0 0 6px; }
  .meta { font-size: 12px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; }
  article.report h1 { font-size: 18px; margin: 18px 0 8px; }
  article.report h2 { font-size: 16px; margin: 16px 0 8px; border-left: 3px solid var(--accent); padding-left: 8px; }
  article.report h3 { font-size: 14px; margin: 12px 0 6px; }
  article.report p { margin: 8px 0; color: #333; }
  article.report ul { padding-left: 22px; margin: 6px 0; }
  article.report li { margin: 3px 0; }
  article.report blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding: 4px 12px; color: var(--muted); background: #f9fafb; }
  article.report code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  article.report hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
  sup.cite a { color: var(--accent); text-decoration: none; font-weight: 600; font-size: 11px; }
  .citations { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 12px; }
  .citations h2 { font-size: 15px; }
  .citations ol { padding-left: 20px; }
  .citations li { margin: 6px 0; font-size: 12px; color: #444; }
  .cite-no { color: var(--accent); font-weight: 600; }
  .cite-src a { color: var(--accent); word-break: break-all; }
  .toolbar { position: fixed; top: 12px; right: 12px; }
  .toolbar button { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; max-width: none; }
    article.report h2 { page-break-after: avoid; }
    a { color: var(--fg); text-decoration: none; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 打印 / 另存为 PDF</button></div>
  <header class="report-head">
    <h1>${escapeHtml(task.topic)}</h1>
    <div class="meta">
      <span>📊 数据来源：${escapeHtml(source)}</span>
      <span>🕒 ${fmtDate}</span>
      ${duration ? `<span>⏱ 耗时 ${duration}</span>` : ""}
      <span>🤖 由 KnowledgeAI 多 Agent 协作生成</span>
    </div>
  </header>
  <article class="report">
    ${body}
  </article>
  ${citeSection}
  <script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},400);});</script>
</body>
</html>`;
}
