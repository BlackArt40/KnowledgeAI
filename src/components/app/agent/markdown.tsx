"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal Markdown renderer tailored to the agent report formats:
// headings, nested bullet lists, blockquote, hr, bold, inline code, [n] cites.
export function Markdown({
  text,
  onCite,
  className,
}: {
  text: string;
  onCite?: (n: number) => void;
  className?: string;
}) {
  const blocks = parseBlocks(text, onCite);
  return <div className={cn("space-y-3 text-sm leading-relaxed", className)}>{blocks}</div>;
}

function parseBlocks(md: string, onCite?: (n: number) => void): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isList = (l: string) => /^\s*([-*]|\d+\.)\s/.test(l);
  const isBlockStart = (l: string) =>
    /^(#{1,3}\s|>\s|---|\s*([-*]|\d+\.)\s)/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push(<hr key={key++} className="my-4 border-border" />);
      i++;
      continue;
    }
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      out.push(<h1 key={key++} className="mt-2 text-xl font-bold tracking-tight">{renderInline(line.slice(2), key, onCite)}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      out.push(<h2 key={key++} className="mt-5 text-base font-semibold">{renderInline(line.slice(3), key, onCite)}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(<h3 key={key++} className="mt-4 text-sm font-semibold">{renderInline(line.slice(4), key, onCite)}</h3>);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(
        <blockquote key={key++} className="rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {renderInline(line.slice(2), key, onCite)}
        </blockquote>
      );
      i++;
      continue;
    }
    if (isList(line)) {
      const items: string[] = [];
      while (i < lines.length && (isList(lines[i]) || lines[i].trim() === "")) {
        if (lines[i].trim() === "") {
          // peek: continue list only if next is also a list item
          if (i + 1 < lines.length && isList(lines[i + 1])) {
            i++;
            continue;
          }
          break;
        }
        items.push(lines[i]);
        i++;
      }
      out.push(renderList(items, key++, onCite));
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p key={key++} className="text-muted-foreground">
        {renderInline(para.join(" "), key, onCite)}
      </p>
    );
  }
  return out;
}

interface ListNode {
  text: string;
  children: ListNode[];
}

function renderList(items: string[], keyBase: number, onCite?: (n: number) => void): React.ReactNode {
  // build tree by indent (2 spaces per level)
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
  const toUl = (nodes: ListNode[], k: number): React.ReactNode => (
    <ul key={k} className="ml-1 space-y-1.5">
      {nodes.map((n, idx) => (
        <li key={idx} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
          <span className="flex-1">
            {renderInline(n.text, k * 100 + idx, onCite)}
            {n.children.length > 0 && toUl(n.children, k * 100 + idx + 1)}
          </span>
        </li>
      ))}
    </ul>
  );
  return toUl(root.children, keyBase);
}

let _key = 0;
function renderInline(text: string, group: number, onCite?: (n: number) => void): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={`${group}-${_key++}`} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={`${group}-${_key++}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (/^\[\d+\]$/.test(tok)) {
      const n = Number(tok.slice(1, -1));
      nodes.push(
        <button
          key={`${group}-${_key++}`}
          onClick={() => onCite?.(n)}
          className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {n}
        </button>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
