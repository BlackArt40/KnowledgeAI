// ---------------------------------------------------------------------------
// Conversation Context - multi-turn dialogue management.
//
// Provides:
//   1. Conversation history compression (last N messages for LLM context)
//   2. Intent recognition (chitchat / meta-question / knowledge query)
//   3. Follow-up question suggestions (LLM-generated or template-based)
// ---------------------------------------------------------------------------

import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";

export type Intent = "chitchat" | "meta" | "knowledge";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Intent Recognition ───────────────────────────────────────────────────

const CHITCHAT_PATTERNS = [
  /^(你好|您好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好)/i,
  /^(谢谢|感谢|thanks|thank you|多谢|辛苦了)/i,
  /^(再见|bye|拜拜|goodbye)/i,
  /^(你是谁|你叫什么|介绍.*自己|about you)/i,
];

const META_PATTERNS = [
  /(有哪些|列表|列出|多少|几个).*(文档|文件|资料|内容)/,
  /(list|show|how many|count).*(document|file|content)/i,
  /知识库.*(概况|概览|统计|信息)/,
  /(支持什么|能做什么|功能|能力)/,
];

/** Classify user query intent. */
export function classifyIntent(query: string): Intent {
  const q = query.trim().toLowerCase();

  for (const pattern of CHITCHAT_PATTERNS) {
    if (pattern.test(q)) return "chitchat";
  }
  for (const pattern of META_PATTERNS) {
    if (pattern.test(q)) return "meta";
  }

  return "knowledge";
}

// ── Conversation History ─────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 6; // last 3 turns (user + assistant)

/**
 * Build conversation history for the LLM prompt.
 * Returns formatted messages (excluding the current query, which is passed separately).
 */
export function buildHistoryMessages(
  history: ChatMessage[]
): { role: "system" | "user" | "assistant"; content: string }[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  return recent.map((m) => ({
    role: m.role,
    content: m.content.slice(0, 500), // truncate to keep context manageable
  }));
}

/**
 * Build a context-aware system prompt that includes conversation history.
 */
export function buildContextualSystemPrompt(
  query: string,
  history: ChatMessage[],
  sources: string
): { role: "system" | "user" | "assistant"; content: string }[] {
  const intent = classifyIntent(query);

  const basePrompt = `你是 KnowledgeAI 知识助手。请根据以下检索到的知识库内容回答用户问题。
要求：
1. 仅基于提供的来源内容回答，不要编造信息
2. 在引用来源处标注 [n]，n 对应来源编号
3. 如果来源中没有相关信息，请如实说明并建议换一种问法
4. 回答简洁专业，使用中文`;

  let systemContent = basePrompt;

  // Add conversation history context
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
  if (recentHistory.length > 0) {
    const historyText = recentHistory
      .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content.slice(0, 300)}`)
      .join("\n");
    systemContent += `\n\n【对话历史】\n${historyText}\n\n请注意：用户的新问题可能需要结合对话历史上下文理解。如果用户使用"它"、"上面提到的"等代词，请参考对话历史。`;
  }

  systemContent += `\n\n【来源】\n${sources}`;

  // Intent-specific instructions
  if (intent === "chitchat") {
    systemContent += "\n\n注意：这是一个闲聊问题，请友好简洁地回答，不需要引用来源。";
  } else if (intent === "meta") {
    systemContent += "\n\n注意：这是一个关于知识库本身的元问题，请基于来源内容概述已有文档信息。";
  }

  return [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: query },
  ];
}

// ── Follow-up Question Suggestions ───────────────────────────────────────

/**
 * Generate follow-up question suggestions based on the query and answer.
 * Uses LLM if configured, otherwise generates template-based suggestions.
 */
export async function suggestFollowUps(
  query: string,
  answer: string,
  chunks?: { docName: string }[]
): Promise<string[]> {
  if (await isLLMEnabled()) {
    return llmFollowUps(query, answer);
  }
  return templateFollowUps(query, answer, chunks);
}

async function llmFollowUps(query: string, answer: string): Promise<string[]> {
  try {
    const prompt = `基于以下问答对，生成 3 个用户可能想继续追问的问题。每个问题一行，不要编号。

用户问题：${query}
回答摘要：${answer.slice(0, 500)}

追问问题应：
- 与当前话题相关但角度不同
- 简短具体（不超过 20 字）
- 可以从知识库中找到答案`;

    const text = await chatComplete(
      [
        { role: "system", content: "你是追问问题生成器。只输出3个问题，每行一个，不要其他内容。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5, maxTokens: 200 }
    );

    if (text) {
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^[\d.、\-*\s]+/, "").trim())
        .filter((l) => l.length > 2 && l.length <= 50)
        .slice(0, 3);
      if (lines.length > 0) return lines;
    }
  } catch {
    // fall through to template
  }
  return templateFollowUps(query, answer);
}

function templateFollowUps(
  query: string,
  answer: string,
  chunks?: { docName: string }[]
): string[] {
  const suggestions: string[] = [];

  // Extract key terms from the query (simple heuristic)
  const keyTerms = query
    .replace(/[？?！!。.，,]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 2);

  if (keyTerms.length > 0) {
    suggestions.push(`${keyTerms[0]}还有什么相关内容？`);
    suggestions.push(`${keyTerms[0]}的具体应用场景是什么？`);
  }

  // Doc-based suggestions
  if (chunks && chunks.length > 0) {
    const docName = chunks[0].docName.replace(/\.[^.]+$/, "");
    suggestions.push(`《${docName}》中还提到了什么？`);
  }

  // Generic suggestions
  if (suggestions.length < 3) {
    suggestions.push("能举个例子吗？");
  }
  if (suggestions.length < 3) {
    suggestions.push("还有其他相关资料吗？");
  }

  return suggestions.slice(0, 3);
}
