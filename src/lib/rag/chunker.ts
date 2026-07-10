// ---------------------------------------------------------------------------
// Smart Text Splitter - heading-aware, table/code-preserving chunking.
//
// Strategies (auto-selected based on content):
//   1. Markdown heading-aware: split by # / ## / ### headings, preserving
//      hierarchy and section context.
//   2. Table preservation: tables (| ... |) are never split across chunks.
//   3. Code block preservation: ``` blocks are kept intact.
//   4. Fallback: character-based with overlap (original behavior).
//
// Each chunk is enriched with a section path prefix (e.g. "## API > ### Auth")
// to give the embedding model more context about where this text lives.
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  /** Add section path prefix to each chunk (improves retrieval context). */
  addSectionPrefix?: boolean;
}

export interface ChunkResult {
  text: string;
  sectionPath: string[];
}

/** Default export: simple string[] for backward compatibility. */
export function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  return smartChunk(text, { chunkSize, chunkOverlap, addSectionPrefix: true })
    .map((c) => c.text);
}

/** Smart chunking with section path metadata. */
export function smartChunk(
  text: string,
  options: ChunkOptions
): ChunkResult[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  // Detect if this is structured Markdown (has headings)
  const hasHeadings = /^#{1,6}\s+/m.test(clean);
  const hasTables = /\|.*\|[\s\S]*?\n\|[-:|\s]+\|/m.test(clean);
  const hasCodeBlocks = /```[\s\S]*?```/m.test(clean);

  if (hasHeadings || hasTables || hasCodeBlocks) {
    return structuredChunk(clean, options);
  }

  // Fallback: character-based with overlap (original behavior)
  return characterChunk(clean, options.chunkSize, options.chunkOverlap)
    .map((text) => ({ text, sectionPath: [] }));
}

// ── Structured chunking (Markdown-aware) ─────────────────────────────────

function structuredChunk(
  text: string,
  options: ChunkOptions
): ChunkResult[] {
  const { chunkSize, chunkOverlap, addSectionPrefix } = options;
  const results: ChunkResult[] = [];
  const sectionStack: string[] = [];

  // Split into blocks: headings, code blocks, tables, and regular text
  const blocks = splitIntoBlocks(text);

  let currentChunk = "";
  let currentPath: string[] = [];

  for (const block of blocks) {
    // Update section stack on headings
    if (block.type === "heading") {
      const level = block.level || 1;
      const title = block.text.replace(/^#+\s*/, "").trim();
      // Truncate stack to current level
      sectionStack.length = Math.max(0, level - 1);
      sectionStack.push(title);
      currentPath = [...sectionStack];

      // Heading text becomes part of the chunk (as context)
      const headingLine = `${"#".repeat(level)} ${title}\n`;
      if (currentChunk.length + headingLine.length > chunkSize && currentChunk) {
        // Flush current chunk
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      currentChunk += headingLine;
      continue;
    }

    // For code blocks and tables: keep intact, don't split
    if (block.type === "code" || block.type === "table") {
      const blockText = block.text + "\n";
      if (currentChunk.length + blockText.length > chunkSize && currentChunk) {
        // Flush current chunk
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      // If block alone exceeds chunkSize, include it anyway (don't split)
      currentChunk += blockText;
      continue;
    }

    // Regular text: may need to split if too long
    if (block.text.length > chunkSize) {
      // Flush current chunk first
      if (currentChunk.trim()) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = "";
      }
      // Split the long text block
      const subChunks = characterChunk(block.text, chunkSize, chunkOverlap);
      for (const sub of subChunks) {
        results.push(finalizeChunk(sub, currentPath, addSectionPrefix));
      }
    } else {
      if (currentChunk.length + block.text.length + 1 > chunkSize && currentChunk) {
        results.push(finalizeChunk(currentChunk, currentPath, addSectionPrefix));
        currentChunk = block.text;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + block.text;
      }
    }
  }

  // Flush remaining
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
