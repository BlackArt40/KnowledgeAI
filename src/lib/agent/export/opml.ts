// ---------------------------------------------------------------------------
// Markdown outline -> OPML (思维导图 export).
//
// OPML is the de-facto interchange format for outliners/mind maps: Xmind,
// MindManager, WorkFlowy and Dynalist all import it. Zero dependencies.
// Criterion #1: 思维导图导出 (Markdown -> Markmap / Xmind).
// ---------------------------------------------------------------------------

interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Parse a markdown report into a hierarchical outline tree. */
export function parseOutline(md: string, rootTitle: string): OutlineNode {
  const root: OutlineNode = { text: rootTitle, children: [] };
  // headingStack holds nodes for h1..h6; index = level-1.
  const headingStack: OutlineNode[] = [];
  let currentHeading: OutlineNode | null = null;
  let listStack: OutlineNode[] = [];

  const pushHeading = (node: OutlineNode, level: number) => {
    while (headingStack.length >= level) headingStack.pop();
    const parent = headingStack.length === 0 ? root : headingStack[headingStack.length - 1];
    parent.children.push(node);
    headingStack.push(node);
  };

  for (const line of md.split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const node: OutlineNode = { text: h[2].trim(), children: [] };
      pushHeading(node, h[1].length);
      currentHeading = node;
      listStack = [];
      continue;
    }
    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const indent = Math.floor(listMatch[1].length / 2);
      const node: OutlineNode = { text: listMatch[3].trim(), children: [] };
      const base = currentHeading ?? root;
      if (indent === 0 || listStack.length === 0) {
        base.children.push(node);
        listStack = [node];
      } else {
        while (listStack.length > indent) listStack.pop();
        if (listStack.length === 0) {
          base.children.push(node);
        } else {
          listStack[listStack.length - 1].children.push(node);
        }
        listStack.push(node);
      }
      continue;
    }
    // ignore paragraphs / blockquotes / hr
  }
  return root;
}

function nodeToOpml(node: OutlineNode, indent: number): string {
  const pad = "  ".repeat(indent);
  if (node.children.length === 0) {
    return `${pad}<outline text="${escapeXml(node.text)}"/>`;
  }
  const children = node.children.map((c) => nodeToOpml(c, indent + 1)).join("\n");
  return `${pad}<outline text="${escapeXml(node.text)}">\n${children}\n${pad}</outline>`;
}

/** Convert a markdown report into a complete OPML document string. */
export function markdownToOpml(md: string, title: string): string {
  const tree = parseOutline(md, title);
  const body = tree.children.map((c) => nodeToOpml(c, 2)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
${body}
  </body>
</opml>
`;
}
