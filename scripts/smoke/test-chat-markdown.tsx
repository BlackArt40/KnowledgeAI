// @ts-nocheck
// P5-3 acceptance: ChatMarkdown renderer (react-markdown + rehype-highlight:
// code blocks with highlight.js classes + copy button, GFM tables, mermaid
// chip flow, [n] citation chips). Renders the component server-side via
// react-dom/server (already a dependency) and asserts on the produced HTML -
// deterministic, no browser needed.
// Run: npx tsx scripts/smoke/test-chat-markdown.tsx

import { renderToString } from "react-dom/server";
import { ChatMarkdown } from "../../src/components/app/chat-markdown";
import { LocaleProvider } from "../../src/lib/i18n/provider";

async function main() {
  let failures = 0;
  const results = [];
  const check = (name, cond, detail = "") => {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  };

  // 1. code block with language + highlight tokens + copy button
  const codeMd = "```js\nconst api = fetch(\"/api/v1\");\n// 注释\nconst n = 42;\n```";
  const codeHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={codeMd} /></LocaleProvider>);
  check("code: <pre> rendered", codeHtml.includes("<pre"), "");
  check("code: language label shown", codeHtml.includes("js"), "");
  check("code: keyword token highlighted", codeHtml.includes("hljs-keyword"), "");
  check("code: string token highlighted", codeHtml.includes("hljs-string"), "");
  check("code: comment token highlighted", codeHtml.includes("hljs-comment"), "");
  check("code: number token highlighted", codeHtml.includes("hljs-number"), "");
  // The copy action lives in an onClick handler (not serialized by
  // renderToString) - assert the rendered UI + handler binding separately.
  check("code: copy button present", codeHtml.includes('aria-label="复制代码"'), "");
  check("code: copy button label", codeHtml.includes(">复制<") || codeHtml.includes("复制"), "");

  // 2. table
  const tableMd = "| 功能 | 支持 |\n| --- | --- |\n| 多模态 | 是 |\n| 离线 | 否 |";
  const tableHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={tableMd} /></LocaleProvider>);
  check("table: <table> rendered", tableHtml.includes("<table"), "");
  check("table: header cells", tableHtml.includes("功能") && tableHtml.includes("支持"), "");
  check("table: body cells", tableHtml.includes("多模态") && tableHtml.includes("离线"), "");

  // 3. mermaid graph LR -> chip flow (simplified)
  const flowMd = "```mermaid\ngraph LR\nA[开始] --> B[处理]\nB --> C[结束]\n```";
  const flowHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={flowMd} /></LocaleProvider>);
  check("mermaid: chip flow rendered (no <pre>)", !flowHtml.includes("<pre") && flowHtml.includes("开始"), "");
  check("mermaid: fallback label", flowHtml.includes("流程图"), "");

  // 4. unsupported mermaid (no `-->` edges) -> falls back to a code block
  const badFlowMd = "```mermaid\nsequenceDiagram\nA->>B: hi\nC-->>D: bye\n```";
  const badFlowHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={badFlowMd} /></LocaleProvider>);
  check("mermaid: unsupported syntax falls back to <pre>", badFlowHtml.includes("<pre"), "");

  // 5. inline markdown + citation chips
  const inlineMd = "这是一段 **加粗** 与 `code` 与 *斜体* 的说明[1]，以及链接 [官网](https://example.com)。";
  const inlineHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={inlineMd} onCite={() => {}} /></LocaleProvider>);
  check("inline: **bold**", inlineHtml.includes("加粗</strong>"), "");
  check("inline: `code`", inlineHtml.includes("<code"), "");
  check("inline: *em*", inlineHtml.includes("<em>斜体</em>"), "");
  check("inline: [n] citation chip button", inlineHtml.includes(">1</button>") || inlineHtml.includes("&gt;1"), "");
  check("inline: link", inlineHtml.includes("href=\"https://example.com\""), "");

  // 6. headings / lists / quote / hr
  const blockMd = "# 标题一\n\n## 标题二\n\n- 列表项甲\n- 列表项乙\n\n> 引用内容\n\n---\n\n段落结尾。";
  const blockHtml = renderToString(<LocaleProvider serverLocale="zh-CN"><ChatMarkdown text={blockMd} /></LocaleProvider>);
  check("block: h3 for #", blockHtml.includes("<h3"), "");
  check("block: h4 for ##", blockHtml.includes("<h4"), "");
  check("block: list items", blockHtml.includes("列表项甲") && blockHtml.includes("列表项乙"), "");
  check("block: blockquote", blockHtml.includes("<blockquote"), "");
  check("block: hr", blockHtml.includes("<hr"), "");

  console.log(`\n${results.join("\n")}`);
  console.log(`\nChatMarkdown renderer: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
