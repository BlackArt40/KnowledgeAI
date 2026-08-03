// @ts-nocheck
async function main() {
  const { smartChunk, chunkText, __test } = await import("../../src/lib/rag/chunker");
  const { computeDensity, dynamicChunkSize } = __test;

  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. computeDensity ──────────────────────────────────────────────────
  const denseText = "```python\ndef foo():\n    return 42\n```\n\n```python\ndef bar():\n    return 99\n```";
  const sparseText = "This is a short paragraph.\n\nAnother short paragraph here.\n\nAnd a third one too.";
  const denseScore = computeDensity(denseText);
  const sparseScore = computeDensity(sparseText);
  check("computeDensity: dense > sparse", denseScore > sparseScore, `dense=${denseScore.toFixed(2)} sparse=${sparseScore.toFixed(2)}`);
  check("computeDensity: dense > 0.3", denseScore > 0.3, `dense=${denseScore.toFixed(2)}`);
  check("computeDensity: sparse < 0.3", sparseScore < 0.3, `sparse=${sparseScore.toFixed(2)}`);

  // ── 2. dynamicChunkSize ────────────────────────────────────────────────
  const baseSize = 500;
  check("dynamicChunkSize: high density shrinks", dynamicChunkSize(baseSize, 0.8) < baseSize, `${dynamicChunkSize(baseSize, 0.8)}`);
  check("dynamicChunkSize: low density grows", dynamicChunkSize(baseSize, 0.1) > baseSize, `${dynamicChunkSize(baseSize, 0.1)}`);
  check("dynamicChunkSize: medium keeps base", dynamicChunkSize(baseSize, 0.45) === baseSize, `${dynamicChunkSize(baseSize, 0.45)}`);

  // ── 3. Dynamic chunking produces different sizes for dense vs sparse ──
  const mdContent = `# Sparse Section

This is a narrative paragraph with some descriptive text. It talks about general concepts in a flowing manner without too much technical detail. The sentences are moderately long and the content is relatively sparse.

## Dense Section

\`\`\`typescript
interface Config {\n  apiKey: string;\n  baseUrl: string;\n  model: string;\n  temperature: number;\n  maxTokens: number;\n  retries: number;\n  timeout: number;\n}
const defaultConfig: Config = {\n  apiKey: "",\n  baseUrl: "https://api.example.com",\n  model: "gpt-4",\n  temperature: 0.3,\n  maxTokens: 2000,\n  retries: 3,\n  timeout: 30000,\n};
function resolveConfig(overrides?: Partial<Config>): Config {\n  return { ...defaultConfig, ...overrides };\n}
\`\`\`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| apiKey | string | "" | API key |
| baseUrl | string | required | Base URL |
| model | string | "gpt-4" | Model name |
`;
  const dynamicResults = smartChunk(mdContent, { chunkSize: 400, chunkOverlap: 50, dynamic: true, addSectionPrefix: true });
  check("dynamic chunking: produces results", dynamicResults.length > 0);

  // ── 4. Parent-child chunking ───────────────────────────────────────────
  const parentResults = smartChunk(mdContent, { chunkSize: 400, chunkOverlap: 50, parentChild: true, addSectionPrefix: true });
  check("parent-child: produces child chunks", parentResults.length > 0);
  const withParent = parentResults.filter((r) => r.parentId !== undefined && r.parentText !== undefined);
  check("parent-child: all children have parentId+parentText", withParent.length === parentResults.length, `${withParent.length}/${parentResults.length}`);
  check("parent-child: parentText is larger than child text", parentResults.every((r) => (r.parentText?.length ?? 0) >= r.text.length));
  const parentIds = new Set(parentResults.map((r) => r.parentId));
  check("parent-child: multiple parents exist", parentIds.size > 1, `${parentIds.size} parents`);

  // ── 5. Acceptance criteria (existing features still work) ──────────────
  // Markdown heading-aware
  const headingMd = "# Title\n\n" + "Para one with enough content to fill. ".repeat(5) + "\n\n## Subtitle\n\n" + "Para two with enough content to fill. ".repeat(5) + "\n\n### Deep\n\n" + "Para three with enough content to fill. ".repeat(5);
  const headingChunks = smartChunk(headingMd, { chunkSize: 150, chunkOverlap: 10, addSectionPrefix: true, dynamic: false });
  check("acceptance: Markdown heading-aware chunking", headingChunks.length >= 2, `got ${headingChunks.length} chunks`);
  check("acceptance: section path metadata present", headingChunks.some((c) => c.sectionPath.length > 0));

  // Table preservation
  const tableMd = "# Data\n\n| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |";
  const tableChunks = smartChunk(tableMd, { chunkSize: 50, chunkOverlap: 5, addSectionPrefix: true });
  const tableIntact = tableChunks.some((c) => c.text.includes("| Col A |") && c.text.includes("| 7 | 8 |"));
  check("acceptance: table not split", tableIntact, "table should be in one chunk");

  // Code block preservation
  const codeMd = "# Code\n\n```python\ndef hello():\n    print('hello world')\n    return True\n```";
  const codeChunks = smartChunk(codeMd, { chunkSize: 50, chunkOverlap: 5, addSectionPrefix: true });
  const codeIntact = codeChunks.some((c) => c.text.includes("```python") && c.text.includes("return True"));
  check("acceptance: code block not split", codeIntact, "code should be in one chunk");

  // ── 6. chunkText backward compatibility ────────────────────────────────
  const simple = chunkText("Just some plain text content here.", 50, 10);
  check("chunkText: backward compatible (returns string[])", Array.isArray(simple) && typeof simple[0] === "string");

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
