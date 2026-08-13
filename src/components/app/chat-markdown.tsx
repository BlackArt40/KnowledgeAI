"use client";

// P5-3: chat answer Markdown renderer via react-markdown + remark-gfm +
// rehype-highlight (replaced the hand-rolled tokenizer in 2026-08, P7-5).
// Block-level: headings / nested lists / blockquotes / hr / paragraphs /
// GFM tables / fenced code blocks (highlight.js via rehype-highlight) with a
// copy button / a simplified ```mermaid `graph LR` chip flow (other mermaid
// syntax falls back to a code block).
// Inline: **bold**, *em*, `code`, [text](url) links and [n] citation chips
// (a rehype plugin turns `[n]` into <button data-cite>; clicks are delegated
// on the container so chips keep the source-highlight interaction).
import * as React from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Plugin } from "unified";
import type { Root, Element, Text } from "hast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n/provider";

// ── [n] citation chips: rehype plugin ────────────────────────────────────
// Rewrites text nodes `[n]` into <button data-cite="n">. Code blocks and
// links are skipped (chips stay valid phrasing content).

const rehypeCiteButtons: Plugin<[]> = () => (tree) => {
  const root = tree as Root;
  const visit = (node: Element): void => {
    if (node.tagName === "code" || node.tagName === "a") return;
    const next: typeof node.children = [];
    for (const child of node.children) {
      if (child.type === "text") {
        const parts = child.value.split(/(\[\d+\])/g);
        if (parts.length === 1) {
          next.push(child);
          continue;
        }
        for (const part of parts) {
          const m = /^\[(\d+)\]$/.exec(part);
          if (m) {
            next.push({
              type: "element",
              tagName: "button",
              properties: {
                type: "button",
                "data-cite": Number(m[1]),
                className: [
                  "mx-0.5", "inline-flex", "h-4", "min-w-4", "-translate-y-0.5",
                  "items-center", "justify-center", "rounded", "bg-primary/15", "px-1",
                  "align-baseline", "text-[10px]", "font-semibold", "text-primary",
                  "transition-colors", "hover:bg-primary", "hover:text-primary-foreground",
                ],
              },
              children: [{ type: "text", value: m[1] }],
            } as Element);
          } else if (part) {
            next.push({ type: "text", value: part } as Text);
          }
        }
      } else {
        if (child.type === "element") visit(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  for (const child of root.children) {
    if (child.type === "element") visit(child);
  }
};

// ── Simplified ```mermaid graph LR chip flow ─────────────────────────────

function nodeLabel(part: string): string {
  const t = part.trim();
  // A["text"] | A[text] | A
  const m = t.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\[(?:"([^"]*)"|([^\]]*))\])?$/);
  if (!m) return t;
  return m[2] ?? m[3] ?? m[1];
}

/** Parse `graph LR` A --> B & C lines into an ordered unique node list. */
function parseGraphLr(code: string): { nodes: string[]; edges: [string, string][] } {
  const edges: [string, string][] = [];
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^graph\s/i.test(line)) continue;
    // `-->` edge marker; `-->>` (sequence diagrams) must not match.
    if (!/-->(?!>)/.test(line)) continue;
    const [fromPart, ...toParts] = line.split(/-->(?!>)/);
    const from = nodeLabel(fromPart);
    for (const toPart of toParts) {
      for (const t of toPart.split("&")) {
        const to = nodeLabel(t);
        if (from && to) edges.push([from, to]);
      }
    }
  }
  const nodes: string[] = [];
  for (const [f, t] of edges) {
    if (!nodes.includes(f)) nodes.push(f);
    if (!nodes.includes(t)) nodes.push(t);
  }
  return { nodes, edges };
}

function MermaidFlow({ code }: { code: string }) {
  const t = useT();
  const { nodes, edges } = React.useMemo(() => parseGraphLr(code), [code]);
  if (edges.length === 0) return null;
  return (
    <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
      {nodes.map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 && <span className="text-muted-foreground">→</span>}
          <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium">
            {n}
          </span>
        </React.Fragment>
      ))}
      <span className="ml-1 text-[10px] text-muted-foreground">{t("page.chat-markdown.s0")}</span>
    </div>
  );
}

// ── Code blocks (highlight.js classes come from rehype-highlight) ────────

/** Flatten React children (text + highlighted spans) into a plain string. */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

const InPreContext = React.createContext(false);

function CodeBlock({ lang, code, children }: { lang: string; code: string; children?: React.ReactNode }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="group relative my-2 overflow-hidden rounded-xl border border-border">
      <div className="flex h-8 items-center justify-between border-b border-border bg-muted/60 px-3">
        <span className="text-[11px] font-medium text-muted-foreground">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("page.chat-markdown.s1")}
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? t("page.chat-markdown.s2") : t("page.chat-markdown.s3")}
        </button>
      </div>
      <pre className="overflow-x-auto bg-zinc-950/90 p-3 font-mono text-[12.5px] leading-relaxed text-zinc-100">
        {children ?? code}
      </pre>
    </div>
  );
}

/** Fenced code blocks (react-markdown maps <pre> here). */
function Pre({ children }: { children?: React.ReactNode }) {
  const child = React.Children.toArray(children).find((c): c is React.ReactElement => React.isValidElement(c));
  const props = (child?.props ?? {}) as { className?: string; children?: React.ReactNode };
  const className = props.className ?? "";
  const langMatch = /language-([\w+-]+)/.exec(className);
  const lang = langMatch ? langMatch[1].toLowerCase() : "";
  const code = textOf(props.children).replace(/\n$/, "");

  if (lang === "mermaid") {
    // Simplified graph LR; unsupported mermaid syntax falls back to a plain
    // code block so nothing is silently dropped.
    if (parseGraphLr(code).edges.length === 0) {
      return <CodeBlock lang="mermaid" code={code} />;
    }
    return <MermaidFlow code={code} />;
  }
  return (
    <InPreContext.Provider value={true}>
      <CodeBlock lang={lang} code={code}>{children}</CodeBlock>
    </InPreContext.Provider>
  );
}

/** Inline code (fenced code inside <pre> just passes the hljs classes through). */
function Code({ className, children }: { className?: string; children?: React.ReactNode }) {
  const inPre = React.useContext(InPreContext);
  if (inPre) {
    return <code className={className}>{children}</code>;
  }
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>;
}

const components = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold tracking-tight">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-sm font-semibold">{children}</h4>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="text-[13px] font-semibold">{children}</h5>
  ),
  pre: Pre,
  code: Code,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table className="text-xs">{children}</Table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }: { children?: React.ReactNode }) => <TableBody>{children}</TableBody>,
  tr: ({ children }: { children?: React.ReactNode }) => <TableRow>{children}</TableRow>,
  th: ({ children }: { children?: React.ReactNode }) => <TableHead>{children}</TableHead>,
  td: ({ children }: { children?: React.ReactNode }) => <TableCell>{children}</TableCell>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal space-y-1 pl-5">{children}</ol>
  ),
  hr: () => <hr className="border-border" />,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
};

export function ChatMarkdown({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  // citation chips are <button data-cite> rendered server-side by the rehype
  // plugin - clicks are delegated here so the handler stays client-only.
  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (!onCite) return;
      const el = (e.target as HTMLElement).closest?.("[data-cite]");
      if (el) {
        const n = Number(el.getAttribute("data-cite"));
        if (Number.isInteger(n)) onCite(n);
      }
    },
    [onCite]
  );

  return (
    <div className="space-y-2.5 text-sm leading-relaxed" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeCiteButtons]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
