// P6-3 unit tests: rag/chunker (pure text splitting).
import { describe, it, expect } from "vitest";
import { smartChunk, chunkText, __test } from "./chunker";

const { computeDensity, dynamicChunkSize } = __test;

describe("chunker computeDensity / dynamicChunkSize", () => {
  it("dense code scores higher than sparse narrative", () => {
    const dense = "```python\ndef foo():\n    return 42\n```\n\n```python\ndef bar():\n    return 99\n```";
    const sparse = "This is a short paragraph.\n\nAnother short paragraph here.\n\nAnd a third one too.";
    expect(computeDensity(dense)).toBeGreaterThan(computeDensity(sparse));
    expect(computeDensity(dense)).toBeGreaterThan(0.3);
    expect(computeDensity(sparse)).toBeLessThan(0.3);
  });

  it("dynamicChunkSize shrinks dense, grows sparse, keeps medium", () => {
    expect(dynamicChunkSize(500, 0.8)).toBeLessThan(500);
    expect(dynamicChunkSize(500, 0.1)).toBeGreaterThan(500);
    expect(dynamicChunkSize(500, 0.45)).toBe(500);
  });
});

describe("chunker smartChunk", () => {
  it("returns [] for empty/whitespace input", () => {
    expect(smartChunk("", { chunkSize: 100, chunkOverlap: 10 })).toEqual([]);
    expect(smartChunk("   \n  ", { chunkSize: 100, chunkOverlap: 10 })).toEqual([]);
  });

  it("splits by markdown headings with section paths", () => {
    const md = "# Title\n\n" + "Para one with enough content to fill. ".repeat(5) +
      "\n\n## Subtitle\n\n" + "Para two with enough content to fill. ".repeat(5) +
      "\n\n### Deep\n\n" + "Para three with enough content to fill. ".repeat(5);
    const chunks = smartChunk(md, { chunkSize: 150, chunkOverlap: 10, addSectionPrefix: true, dynamic: false });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.sectionPath.length > 0)).toBe(true);
    expect(chunks.some((c) => c.text.includes("[Title"))).toBe(true);
  });

  it("keeps tables intact in one chunk", () => {
    const md = "# Data\n\n| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |";
    const chunks = smartChunk(md, { chunkSize: 50, chunkOverlap: 5, addSectionPrefix: true });
    expect(chunks.some((c) => c.text.includes("| Col A |") && c.text.includes("| 7 | 8 |"))).toBe(true);
  });

  it("keeps code blocks intact", () => {
    const md = "# Code\n\n```python\ndef hello():\n    print('hello world')\n    return True\n```";
    const chunks = smartChunk(md, { chunkSize: 50, chunkOverlap: 5, addSectionPrefix: true });
    expect(chunks.some((c) => c.text.includes("```python") && c.text.includes("return True"))).toBe(true);
  });

  it("falls back to character chunking for plain text", () => {
    const text = "Plain text without any structure. ".repeat(40);
    const chunks = smartChunk(text, { chunkSize: 100, chunkOverlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].sectionPath).toEqual([]);
    // every chunk within (chunkSize + slack) length
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(110);
  });

  it("parent-child produces children with parent context", () => {
    const md = "# Sparse Section\n\n" + "Narrative paragraph with a moderate amount of descriptive text. ".repeat(10) +
      "\n\n## Dense Section\n\n```typescript\ninterface Config {\n  apiKey: string;\n  baseUrl: string;\n  model: string;\n  temperature: number;\n}\n```";
    const chunks = smartChunk(md, { chunkSize: 400, chunkOverlap: 50, parentChild: true, addSectionPrefix: true });
    expect(chunks.length).toBeGreaterThan(0);
    const withParent = chunks.filter((c) => c.parentId !== undefined && c.parentText !== undefined);
    expect(withParent.length).toBe(chunks.length);
    for (const c of chunks) expect((c.parentText?.length ?? 0)).toBeGreaterThanOrEqual(c.text.length);
  });
});

describe("chunker chunkText (backward compat)", () => {
  it("returns plain string[]", () => {
    const out = chunkText("Just some plain text content here.", 50, 10);
    expect(Array.isArray(out)).toBe(true);
    expect(typeof out[0]).toBe("string");
  });
});
