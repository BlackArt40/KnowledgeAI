// ---------------------------------------------------------------------------
// Server-side Markdown -> HTML renderer.
//
// Mirrors the block/inline grammar of the client <Markdown/> component
// (src/components/app/agent/markdown.tsx) but emits an HTML string. Used by
// the PDF print document and any server-rendered report view.
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render inline markdown: **bold**, `code`, [n] cite -> clickable anchor. */
function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // [n] citation marker -> superscript link to the citations list.
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite"><a href="#cite-$1">[$1]</a></sup>');
  return s;
}

interface ListNode {
  text: string;
  children: ListNode[];
}

function renderListHtml(items: string[]): string {
  const root: ListNode = { text: "", children: [] };
  const stack: { node: ListNode; indent: number }[] = [{ node: root, indent: -1 }];
  for (const raw of items) {
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim().replace(/^([-*]|\d+\.)\s+/, "");
    const node: ListNode = { text, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, indent });
  }
  const toUl = (nodes: ListNode[]): string => {
    if (nodes.length === 0) return "";
    const lis = nodes
      .map((n) => `<li>${renderInline(n.text)}${toUl(n.children)}</li>`)
      .join("");
    return `<ul>${lis}</ul>`;
  };
  return toUl(root.children);
}

/** Render a full markdown document to an HTML fragment string. */
export function renderMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  const isList = (l: string) => /^\s*([-*]|\d+\.)\s/.test(l);
  const isBlockStart = (l: string) => /^(#{1,3}\s|>\s|---|\s*([-*]|\d+\.)\s)/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push("<hr/>");
      i++;
      continue;
    }
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      out.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      out.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(`<h3>${renderInline(line.slice(4))}</h3>`);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
      i++;
      continue;
    }
    if (isList(line)) {
      const items: string[] = [];
      while (i < lines.length && (isList(lines[i]) || lines[i].trim() === "")) {
        if (lines[i].trim() === "") {
          if (i + 1 < lines.length && isList(lines[i + 1])) {
            i++;
            continue;
          }
          break;
        }
        items.push(lines[i]);
        i++;
      }
      out.push(renderListHtml(items));
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
