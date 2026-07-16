// Smoke test for the stripHtml refactor + parseWord HTML route.
// Tests the pure-logic tag stripping by feeding synthetic HTML through parseHtml.
async function main() {
  const { parseDocument } = await import("../src/lib/rag/parser");

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) { console.error(`❌ ${msg}`); failures++; }
    else console.log(`✅ ${msg}`);
  }

  // parseHtml strips tags, decodes entities, collapses whitespace.
  // Body must exceed the 40-char minimum guard in parseHtml.
  const html = Buffer.from(
    "<html><head><title>Doc Title</title></head><body><h1>Hello World Heading</h1><p>This is paragraph text with &amp; ampersand and &lt;b&gt;bold&lt;/b&gt; content here.</p><script>bad()</script></body></html>",
    "utf-8"
  );
  const parsed = await parseDocument(html, "x.html", "web");
  assert(parsed !== null, "parseHtml returns non-null");
  assert(parsed!.title === "Doc Title", `title extracted (got ${parsed!.title})`);
  assert(parsed!.text.includes("Hello World Heading"), "heading text present");
  assert(parsed!.text.includes("& ampersand and <b>bold</b>"), "entities decoded, tags stripped");
  assert(!parsed!.text.includes("bad()"), "script content removed");
  assert(!parsed!.text.includes("<h1>"), "no raw h1 tag remains");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
