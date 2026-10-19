// Chat/Agent markdown 渲染（V4）。基线与 SharedReportView 一致：
// markdown-it html:false 关闭原始 HTML（XSS 防线）。Chat 侧额外把正文里的
// [n] 引用标记转成可点击 chip（容器 click 委托读 data-cite）——等价于 Next
// 侧 chat-markdown.tsx 的 rehype 插件；<pre>/<code> 内不转换（split 捕获组
// 使代码段落在奇数位原样返回）。
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(text: string): string {
  return md.render(text);
}

/** 渲染并注入 [n] 引用 chip。 */
export function renderChatMarkdown(text: string): string {
  const html = md.render(text);
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[(\d+)\]/g, '<button type="button" data-cite="$1" class="cite-chip">$1</button>')
    )
    .join("");
}
