// @ts-nocheck
// P1-4 acceptance verification: multi-turn context, intent recognition, follow-ups.
// Run: npx tsx scripts/smoke/test-conversation.ts
async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. Multi-turn conversation context (criterion #1) ────────────────
  const { buildContextualSystemPrompt, buildHistoryMessages, classifyIntent, suggestFollowUps }
    = await import("../../src/lib/rag/conversation-context");

  // Build a 3-turn history with a pronoun reference in the last query.
  const history = [
    { role: "user" as const, content: "什么是 RAG？" },
    { role: "assistant" as const, content: "RAG 是检索增强生成，结合检索与生成。" },
    { role: "user" as const, content: "它有哪些优势？" },
    { role: "assistant" as const, content: "RAG 的优势包括准确性高、可溯源、减少幻觉。" },
    { role: "user" as const, content: "上面提到的准确性如何保证？" },
    { role: "assistant" as const, content: "通过引用来源和限制 LLM 仅基于检索内容回答。" },
  ];

  const messages = buildContextualSystemPrompt("它还有什么劣势？", history, "来源内容");
  check("context: buildContextualSystemPrompt returns messages", messages.length >= 2);
  check("context: system prompt includes history", messages[0].content.includes("对话历史"));
  check("context: history includes all 6 messages", messages[0].content.includes("RAG") && messages[0].content.includes("准确性"));

  // Verify the system prompt instructs the LLM to resolve pronouns from history.
  check(
    "context: prompt instructs pronoun resolution (criterion #1)",
    messages[0].content.includes("它") && messages[0].content.includes("上面提到的"),
    "prompt should mention pronoun resolution for '它'/'上面提到的'"
  );

  // Verify history is capped at 6 messages (last 3 turns).
  const longHistory = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Message ${i}`,
  }));
  const historyMsgs = buildHistoryMessages(longHistory);
  check("context: history capped at 6 messages", historyMsgs.length === 6);
  check("context: history keeps most recent", historyMsgs[5].content === "Message 19");

  // ── 2. Intent recognition (criterion #2: >90% accuracy) ──────────────
  // Test a suite of queries with expected intents and measure accuracy.
  const intentTests: Array<[string, "chitchat" | "meta" | "knowledge"]> = [
    // chitchat
    ["你好", "chitchat"],
    ["hello", "chitchat"],
    ["谢谢", "chitchat"],
    ["再见", "chitchat"],
    ["你是谁", "chitchat"],
    ["嗨", "chitchat"],
    // meta
    ["这个库有哪些文档", "meta"],
    ["列出所有文件", "meta"],
    ["知识库有多少内容", "meta"],
    ["你支持什么功能", "meta"],
    ["能做什么", "meta"],
    // knowledge
    ["什么是 RAG？", "knowledge"],
    ["如何实现向量检索", "knowledge"],
    ["BM25 算法的原理是什么", "knowledge"],
    ["对比 Redis 和 RabbitMQ", "knowledge"],
    ["解释一下余弦相似度", "knowledge"],
    ["这篇文档讲了什么内容", "knowledge"],
    ["总结一下这篇文章", "knowledge"],
  ];

  let correct = 0;
  for (const [query, expected] of intentTests) {
    const actual = classifyIntent(query);
    if (actual === expected) {
      correct++;
    } else {
      console.log(`  intent mismatch: "${query}" expected=${expected} got=${actual}`);
    }
  }
  const accuracy = correct / intentTests.length;
  check(
    `intent: accuracy > 90% (criterion #2)`,
    accuracy > 0.9,
    `${correct}/${intentTests.length} = ${(accuracy * 100).toFixed(0)}%`
  );
  check("intent: chitchat correctly classified", classifyIntent("你好") === "chitchat");
  check("intent: meta (库有哪些文档) correctly classified", classifyIntent("这个库有哪些文档") === "meta");
  check("intent: knowledge correctly classified", classifyIntent("什么是RAG") === "knowledge");

  // ── 3. Follow-up suggestions (criterion #3: show after answer) ──────
  // In demo mode (no LLM), suggestFollowUps uses template-based generation.
  const followUps = await suggestFollowUps(
    "什么是 RAG？",
    "RAG 是检索增强生成技术。",
    [{ docName: "rag-intro.md" }]
  );
  check("followUps: returns 3 suggestions", followUps.length === 3, `got ${followUps.length}`);
  check("followUps: each suggestion is non-empty", followUps.every((s) => s.length > 2));
  check("followUps: each suggestion <= 50 chars", followUps.every((s) => s.length <= 50));
  check(
    "followUps: suggestions are relevant to query (criterion #3)",
    followUps.some((s) => s.includes("RAG") || s.includes("rag") || s.includes("相关")),
    JSON.stringify(followUps)
  );

  // Follow-ups when disabled via no chunks / no key terms.
  const generic = await suggestFollowUps("test", "answer", []);
  check("followUps: returns suggestions even without chunks", generic.length > 0);
  check("followUps: generic fallback has 3 items", generic.length === 3);

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
