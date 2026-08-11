"use client";

import { useT } from "@/lib/i18n/provider";
// P5-3: chat answer Markdown renderer (zero dependencies, hand-written).
// Block-level: headings / nested lists / blockquotes / hr / paragraphs /
// tables (| a | b |) / fenced code blocks with lightweight syntax
// highlighting + a copy button / a simplified ```mermaid `graph LR` chip
// flow (other mermaid syntax falls back to a code block).
// Inline: **bold**, *em*, `code`, [text](url) links and [n] citation chips
// (clicking a chip highlights the matching source, same as the old RichText).
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Inline: **bold**, *em*, `code`, links, [n] chips ─────────────────────

function renderInline(text: string, onCite?: (n: number) => void, keyBase = 0): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // [n] citation chips
  const parts = text.split(/(\[\d+\])/g);
  parts.forEach((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (m && onCite) {
      nodes.push(
        <button
          key={`${keyBase}-c${i}`}
          type="button"
          onClick={() => onCite(Number(m[1]))}
          className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {m[1]}
        </button>
      );
      return;
    }
    if (m) {
      nodes.push(<span key={`${keyBase}-c${i}`}>[{m[1]}]</span>);
      return;
    }
    // links [text](url)
    const rest = p;
    const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let lm: RegExpExecArray | null;
    let last = 0;
    let linkKey = 0;
    while ((lm = linkRe.exec(rest))) {
      if (lm.index > last) {
        nodes.push(
          <React.Fragment key={`${keyBase}-i${i}-${linkKey++}`}>
            {renderInlineInner(rest.slice(last, lm.index), keyBase, i, linkKey)}
          </React.Fragment>
        );
      }
      nodes.push(
        <a
          key={`${keyBase}-l${i}-${linkKey++}`}
          href={lm[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {lm[1]}
        </a>
      );
      last = lm.index + lm[0].length;
    }
    if (last < rest.length) {
      nodes.push(
        <React.Fragment key={`${keyBase}-t${i}-${linkKey}`}>
          {renderInlineInner(rest.slice(last), keyBase, i, linkKey)}
        </React.Fragment>
      );
    }
  });
  return nodes;
}

// **bold** / *em* / `code` (single-pass tokenizer)
function renderInlineInner(text: string, keyBase: number, seg: number, k: number): React.ReactNode {
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={`${keyBase}-${seg}-${k}-${i++}`}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-${seg}-${k}-${i++}`} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-${seg}-${k}-${i++}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<em key={`${keyBase}-${seg}-${k}-${i++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={`${keyBase}-${seg}-${k}-${i}`}>{text.slice(last)}</span>);
  return out.length > 0 ? <>{out}</> : text;
}

// ── Syntax highlighting (lightweight, zero deps) ─────────────────────────

const KEYWORDS: Record<string, string[]> = {
  js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "of", "in", "new", "async", "await", "import", "from", "export", "default", "class", "extends", "try", "catch", "finally", "throw", "typeof", "instanceof", "null", "undefined", "true", "false", "this", "switch", "case", "break", "continue", "yield", "delete", "void", "do", "static", "get", "set"],
  ts: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "of", "in", "new", "async", "await", "import", "from", "export", "default", "class", "extends", "implements", "interface", "type", "enum", "namespace", "try", "catch", "finally", "throw", "typeof", "instanceof", "null", "undefined", "true", "false", "this", "switch", "case", "break", "continue", "yield", "delete", "void", "readonly", "public", "private", "protected", "abstract", "as", "satisfies", "unknown", "never", "any"],
  python: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "raise", "with", "lambda", "pass", "break", "continue", "yield", "global", "nonlocal", "True", "False", "None", "is", "assert", "del"],
  bash: ["if", "then", "else", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "echo", "export", "local", "read", "set", "unset", "shift", "exit", "source", "alias"],
  json: ["true", "false", "null"],
};

const SHARED_KEYWORDS = ["const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "from", "export", "class", "try", "catch", "new", "async", "await", "null", "undefined", "true", "false", "this", "switch", "case", "break", "continue", "default", "throw", "type", "interface", "enum", "def", "in", "not", "and", "or", "with", "as", "lambda", "pass", "echo", "fi", "then", "do", "done", "elif", "raise", "yield", "return"];

function langKeywords(lang: string): Set<string> {
  const list = KEYWORDS[lang.toLowerCase()] ?? SHARED_KEYWORDS;
  return new Set(list);
}

/** Highlight a single line into <span class="tok-*"> tokens. */
function highlightLine(line: string, kws: Set<string>, keyBase: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|#.*$|\b\d+(?:\.\d+)?\b|([A-Za-z_$][\w$]*)(?=\s*\()|[A-Za-z_$][\w$]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) nodes.push(<span key={`${keyBase}-${i++}`}>{line.slice(last, m.index)}</span>);
    const tok = m[0];
    let cls = "";
    if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) cls = "tok-str";
    else if (tok.startsWith("//") || tok.startsWith("#")) cls = "tok-com";
    else if (/^\d/.test(tok)) cls = "tok-num";
    else if (m[2]) cls = "tok-fn"; // identifier followed by (
    else if (kws.has(tok)) cls = "tok-kw";
    nodes.push(
      cls ? (
        <span key={`${keyBase}-${i++}`} className={cls}>{tok}</span>
      ) : (
        <span key={`${keyBase}-${i++}`}>{tok}</span>
      )
    );
    last = m.index + tok.length;
  }
  if (last < line.length) nodes.push(<span key={`${keyBase}-${i}`}>{line.slice(last)}</span>);
  return nodes;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const kws = React.useMemo(() => langKeywords(lang), [lang]);
  const lines = code.replace(/\n$/, "").split("\n");
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
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre">{highlightLine(l, kws, i)}</div>
        ))}
      </pre>
    </div>
  );
}

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
      {edges.length === 0 ? null : (
        <span className="ml-1 text-[10px] text-muted-foreground">{t("page.chat-markdown.s0")}</span>
      )}
    </div>
  );
}

// ── Block parsing ─────────────────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: { text: string; depth: number }[] }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "code"; lang: string; code: string }
  | { kind: "mermaid"; code: string }
  | { kind: "table"; header: string[]; rows: string[][] };

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.split("|").length >= 3;
}

function parseTable(lines: string[]): { header: string[]; rows: string[][]; consumed: number } | null {
  const splitRow = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  if (!isTableRow(lines[0])) return null;
  const header = splitRow(lines[0]);
  // separator line must be dashes with optional colons (e.g. |---|---|)
  if (lines.length < 2 || !/^[\s|:-]+$/.test(lines[1]) || !lines[1].includes("-")) return null;
  const rows: string[][] = [];
  let consumed = 2;
  while (consumed < lines.length && isTableRow(lines[consumed])) {
    rows.push(splitRow(lines[consumed]));
    consumed++;
  }
  return { header, rows, consumed };
}

export function ChatMarkdown({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const t = useT();
  const blocks = React.useMemo(() => {
    const lines = text.split("\n");
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // fenced code block
      const fence = trimmed.match(/^```([\w+-]*)\s*$/);
      if (fence) {
        const lang = fence[1] ?? "";
        const buf: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          buf.push(lines[i]);
          i++;
        }
        i++; // closing fence
        const code = buf.join("\n");
        if (lang.toLowerCase() === "mermaid") {
          out.push({ kind: "mermaid", code });
        } else {
          out.push({ kind: "code", lang, code });
        }
        continue;
      }

      // headings
      const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        out.push({ kind: "heading", level: h[1].length, text: h[2] });
        i++;
        continue;
      }

      // table
      if (isTableRow(line) && lines[i + 1] && lines[i + 1].includes("-")) {
        const tbl = parseTable(lines.slice(i));
        if (tbl) {
          out.push({ kind: "table", header: tbl.header, rows: tbl.rows });
          i += tbl.consumed;
          continue;
        }
      }

      // hr
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        out.push({ kind: "hr" });
        i++;
        continue;
      }

      // quote (single line)
      if (trimmed.startsWith("> ")) {
        out.push({ kind: "quote", text: trimmed.slice(2) });
        i++;
        continue;
      }

      // list (accumulate consecutive items, track depth)
      if (/^\s*([-*]|\d+\.)\s/.test(line)) {
        const items: { text: string; depth: number }[] = [];
        while (i < lines.length) {
          const li = lines[i];
          const lm = li.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
          if (!lm) break;
          items.push({ text: lm[3], depth: Math.floor(lm[1].length / 2) });
          i++;
        }
        out.push({ kind: "list", items });
        continue;
      }

      // blank line / paragraph
      if (!trimmed) {
        i++;
        continue;
      }
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        buf.push(lines[i]);
        i++;
      }
      out.push({ kind: "para", text: buf.join(" ") });
    }
    return out;
  }, [text]);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {blocks.map((b, bi) => {
        switch (b.kind) {
          case "heading":
            if (b.level === 1) return <h3 key={bi} className="text-base font-semibold tracking-tight">{renderInline(b.text, onCite, bi)}</h3>;
            if (b.level === 2) return <h4 key={bi} className="text-sm font-semibold">{renderInline(b.text, onCite, bi)}</h4>;
            return <h5 key={bi} className="text-[13px] font-semibold">{renderInline(b.text, onCite, bi)}</h5>;
          case "para":
            return <p key={bi}>{renderInline(b.text, onCite, bi)}</p>;
          case "list": {
            const maxDepth = Math.max(...b.items.map((x) => x.depth));
            if (maxDepth === 0) {
              return (
                <ul key={bi} className="space-y-1 pl-5">
                  {b.items.map((it, k) => (
                    <li key={k} className="list-disc">{renderInline(it.text, onCite, bi * 100 + k)}</li>
                  ))}
                </ul>
              );
            }
            // nested: group by depth into a flat tree
            return (
              <ul key={bi} className="space-y-1 pl-5">
                {b.items.map((it, k) => (
                  <li key={k} className={cn(it.depth > 0 && "list-disc")} style={{ marginLeft: `${it.depth * 1.25}rem` }}>
                    {renderInline(it.text, onCite, bi * 100 + k)}
                  </li>
                ))}
              </ul>
            );
          }
          case "quote":
            return (
              <blockquote key={bi} className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderInline(b.text, onCite, bi)}
              </blockquote>
            );
          case "hr":
            return <hr key={bi} className="border-border" />;
          case "code":
            return <CodeBlock key={bi} lang={b.lang} code={b.code} />;
          case "mermaid": {
            // Simplified graph LR; unsupported mermaid syntax falls back to
            // a plain code block so nothing is silently dropped.
            if (parseGraphLr(b.code).edges.length === 0) {
              return <CodeBlock key={bi} lang="mermaid" code={b.code} />;
            }
            return <MermaidFlow key={bi} code={b.code} />;
          }
          case "table":
            return (
              <div key={bi} className="overflow-x-auto rounded-xl border border-border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      {b.header.map((h, k) => (
                        <TableHead key={k}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.rows.map((r, k) => (
                      <TableRow key={k}>
                        {r.map((c, j) => (
                          <TableCell key={j}>{renderInline(c, onCite, bi * 1000 + k * 10 + j)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
        }
      })}
    </div>
  );
}
