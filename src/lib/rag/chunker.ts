// ---------------------------------------------------------------------------
// Smart Text Splitter - heading-aware, table/code-preserving chunking.
//
// Strategies (auto-selected based on content):
//   1. Markdown heading-aware: split by # / ## / ### headings, preserving
//      hierarchy and section context.
//   2. Table preservation: tables (| ... |) are never split across chunks.
//   3. Code block preservation: ``` blocks are kept intact.
//   4. Dynamic chunking: adjusts chunk size by content density (code/table
//      ratio + sentence length). Dense sections get smaller chunks for
//      precise retrieval; sparse sections get larger chunks for context.
//   5. Parent-child strategy: indexes small "child" chunks for precise
//      embedding match, but returns the larger "parent" chunk text for
//      generation (context preservation via retriever expansion).
//   6. Fallback: character-based with overlap (original behavior).
//
// Each chunk is enriched with a section path prefix (e.g. "## API > ### Auth")
// to give the embedding model more context about where this text lives.
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  /** Add section path prefix to each chunk (improves retrieval context). */
  addSectionPrefix?: boolean;
  /** Adjust chunk size by content density (dense=smaller, sparse=larger). */
  dynamic?: boolean;
  /** Use parent-child strategy: index small chunks, return parent context. */
  parentChild?: boolean;
}

export interface ChunkResult {
  text: string;
  sectionPath: string[];
  /** Parent chunk ID (for parent-child strategy). */
  parentId?: string;
  /** Full parent chunk text (for context expansion at retrieval time). */
  parentText?: string;
}

/** Default export: simple string[] for backward compatibility. */
export function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  return smartChunk(text, { chunkSize, chunkOverlap, addSectionPrefix: true, dynamic: true })
    .map((c) => c.text);
}

/** Smart chunking with section path metadata, dynamic sizing, and parent-child. */
export function smartChunk(
  text: string,
  options: ChunkOptions
): ChunkResult[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  if (options.parentChild) {
    return parentChildChunk(clean, options);
  }

  const hasHeadings = /^#{1,6}\s+/m.test(clean);
  const hasTables = /\|.*\|[\s\S]*?\n\|[-:|\s]+\|/m.test(clean);
  const hasCodeBlocks = /```[\s\S]*?```/m.test(clean);

  if (hasHeadings || hasTables || hasCodeBlocks) {
    return structuredChunk(clean, options);
  }

  return characterChunk(clean, options.chunkSize, options.chunkOverlap)
    .map((text) => ({ text, sectionPath: [] }));
}

// ── Density-based dynamic chunk sizing ───────────────────────────────────

/** Estimate content density (0=sparse, 1=dense). Dense = code/tables/long
 *  sentences; sparse = short narrative paragraphs. Used to shrink chunks for
 *  dense sections (precise retrieval) and grow them for sparse (more context). */
function computeDensity(text: string): number {
  const lines = text.split("\n");
  let structural = 0;
  for (const line of lines) {
    if (line.trim().startsWith("|") || line.trim().startsWith("```") || /^\s{4,}/.test(line)) {
      structural++;
    }
  }
  const structuralRatio = lines.length > 0 ? structural / lines.length : 0;
  const sentences = text.split(/[.。!！?？\n]+/).filter((s) => s.trim().length > 10);
  const totalChars = text.length;
  const avgSentLen = sentences.length > 0 ? totalChars / sentences.length : 50;
  const sentenceDensity = Math.min(1, avgSentLen / 200);
  return Math.min(1, structuralRatio * 0.6 + sentenceDensity * 0.4);
}

function dynamicChunkSize(baseSize: number, density: number): number {
  if (density > 0.6) return Math.round(baseSize * 0.7);
  if (density < 0.3) return Math.round(baseSize * 1.3);
  return baseSize;
}

// ── Structured chunking (Markdown-aware) ─────────────────────────────────

function structuredChunk(
  text: string,
  options: ChunkOptions
): ChunkResult[] {
  const { chunkSize, chunkOverlap, addSectionPrefix, dynamic } = options;
  const results: ChunkResult[] = [];
  const sectionStack: string[] = [];

  const blocks = splitIntoBlocks(text);

  let currentChunk = "";
  let currentPath: string[] = [];

  for (const block of blocks) {
    const effSize = dynamic
      ? dynamicChunkSize(chunkSize, computeDensity(block.text))
      : chunkSize;

    if (block.type === "heading") {
      const level = block.level || 1;
      const title = block.text.replace(/^#+\s*/, "").trim();
      sectionStack.length = Math.max(0, level - 1);
      sectionStack.push(title);
      currentPath = [...sectionStack];

      const headingLine = `${"#".repeat(level)} ${title}\n`;
      if (currentChunk.length + headingLine.length > effSize && currentChunk) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      currentChunk += headingLine;
      continue;
    }

    if (block.type === "code" || block.type === "table") {
      const blockText = block.text + "\n";
      if (currentChunk.length + blockText.length > effSize && currentChunk) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      currentChunk += blockText;
      continue;
    }

    if (block.text.length > effSize) {
      if (currentChunk.trim()) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      const subChunks = characterChunk(block.text, effSize, chunkOverlap);
      for (const sub of subChunks) {
        results.push(finalizeChunk(sub, currentPath, addSectionPrefix));
      }
    } else {
      if (currentChunk.length + block.text.length + 1 > effSize && currentChunk) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = block.text;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + block.text;
      }
    }
  }

  if (currentChunk.trim()) {
    results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
  }

  return results.length > 0 ? results : [{ text, sectionPath: [] }];
}

interface Block {
  type: "heading" | "code" | "table" | "text";
  text: string;
  level?: number;
}

/** Split text into semantic blocks: headings, code blocks, tables, and text. */
function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
      i++; // include closing ```
      blocks.push({
        type: "code",
        text: lines.slice(start, i).join("\n"),
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        text: line,
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }

    // Table (line starts with | and next line is separator)
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|[-:|\s]+/.test(lines[i + 1])) {
      const start = i;
      i += 2; // header + separator
      while (i < lines.length && lines[i].trim().startsWith("|")) i++;
      blocks.push({
        type: "table",
        text: lines.slice(start, i).join("\n"),
      });
      continue;
    }

    // Regular text (accumulate consecutive non-special lines)
    const textLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && /^\|[-:|\s]+/.test(lines[i + 1]))
    ) {
      textLines.push(lines[i]);
      i++;
    }
    if (textLines.length > 0) {
      blocks.push({ type: "text", text: textLines.join("\n") });
    }
  }

  return blocks;
}

/** Add section path prefix to chunk text for better embedding context. */
function finalizeChunk(
  text: string,
  sectionPath: string[],
  addPrefix?: boolean
): ChunkResult {
  let finalText = text.trim();
  if (addPrefix && sectionPath.length > 0) {
    const prefix = sectionPath.join(" > ");
    // Only add prefix if it's not already at the start of the chunk
    if (!finalText.startsWith(prefix)) {
      finalText = `[${prefix}]\n${finalText}`;
    }
  }
  return { text: finalText, sectionPath };
}

// ── Character-based chunking (fallback) ──────────────────────────────────

function characterChunk(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= chunkSize) return clean ? [clean] : [];

  const step = Math.max(1, chunkSize - chunkOverlap);
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + chunkSize, clean.length);
    // try to break on a sentence/paragraph boundary near the end
    if (end < clean.length) {
      const boundary = clean.lastIndexOf("\n", end);
      if (boundary > i + chunkSize * 0.5) end = boundary;
    }
    const chunk = clean.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    i += step;
  }
  return chunks;
}

// ── Parent-child chunking (context preservation) ─────────────────────────

function parentChildChunk(
  text: string,
  options: ChunkOptions
): ChunkResult[] {
  const { chunkSize, addSectionPrefix } = options;
  const parentSize = chunkSize * 2;
  const childSize = Math.max(50, Math.round(chunkSize / 2));
  const childOverlap = Math.round(childSize * 0.2);

  const parents = structuredChunk(text, {
    ...options,
    chunkSize: parentSize,
    chunkOverlap: 0,
    parentChild: false,
    dynamic: false,
  });

  const children: ChunkResult[] = [];
  for (let pi = 0; pi < parents.length; pi++) {
    const parent = parents[pi];
    const childTexts = characterChunk(parent.text, childSize, childOverlap);
    for (const childText of childTexts) {
      children.push({
        text: addSectionPrefix && parent.sectionPath.length > 0
          ? `[${parent.sectionPath.join(" > ")}]\n${childText}`
          : childText,
        sectionPath: parent.sectionPath,
        parentId: `${pi}`,
        parentText: parent.text,
      });
    }
  }
  return children;
}

export const __test = { computeDensity, dynamicChunkSize };
