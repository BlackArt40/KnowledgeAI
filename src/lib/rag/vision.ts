// ---------------------------------------------------------------------------
// Image description (P7-4) - used by:
//   - parseImage: transcribes the image so scanned documents / screenshots are
//     fully searchable (a short caption would drop most of the text)
//   - chat multimodal: supplies the image text so the answer can reference it
//
// Two paths:
//   - LLM configured (isLLMEnabled): chatComplete with OpenAI content parts
//     (text + image_url base64) -> natural-language description
//   - demo fallback: OCR the image (tesseract) + dimensions via @napi-rs/canvas
//     -> deterministic, offline, works without any provider
// ---------------------------------------------------------------------------

import { isLLMEnabled, chatComplete } from "@/lib/llm/provider";
import { ocrImage } from "./ocr";

/** Max characters kept in a chat context line (mirrors the OCR cap). */
const CONTEXT_MAX_CHARS = 2000;

/** Transcription prompt: the parsed document must contain the actual text,
 *  not a paraphrased summary - retrieval matches on literal strings. */
const VISION_TRANSCRIBE_PROMPT =
  "请完整、逐字转录这张图片中的所有可见文字，保持原有的行序、换行与表格/列表结构。" +
  "只输出转录出的文字本身，不要总结、翻译或添加任何解释。" +
  "如果图片中确实没有任何文字，再改用中文简要描述图片内容。";

/** Transcription output can be long (a full scanned page). */
const VISION_MAX_TOKENS = 4000;

export interface ImageDescription {
  /** Natural-language description (LLM path) or OCR text (demo path). */
  text: string;
  source: "vision" | "ocr";
  width: number;
  height: number;
}

async function imageDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  try {
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    return { width: img.width, height: img.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Describe an image buffer. LLM path when a real chat model is configured;
 * otherwise OCR + dimensions (deterministic demo fallback).
 */
export async function describeImage(buf: Buffer, mime = "image/png"): Promise<ImageDescription | null> {
  const { width, height } = await imageDimensions(buf);
  if (await isLLMEnabled()) {
    try {
      const data = buf.toString("base64");
      const text = await chatComplete(
        [
          {
            role: "user",
            content: VISION_TRANSCRIBE_PROMPT,
            images: [{ mime, data }],
          },
        ],
        // Full transcripts are much longer than a one-line caption.
        { temperature: 0, maxTokens: VISION_MAX_TOKENS }
      );
      if (text && text.trim().length > 2) {
        return { text: text.trim(), source: "vision", width, height };
      }
    } catch {
      // fall through to OCR
    }
  }
  const ocr = await ocrImage(buf);
  if (ocr && ocr.length > 1) {
    return { text: ocr, source: "ocr", width, height };
  }
  if (width > 0 && height > 0) {
    return { text: `（图片 ${width}×${height}，无文字内容）`, source: "ocr", width, height };
  }
  return null;
}

/**
 * One context line for a chat question (demo mode): OCR/vision text of the
 * image prefixed with 【图片内容】 so the extractive/LLM answer can reference it.
 */
export async function imageContextLine(buf: Buffer, mime: string): Promise<string | null> {
  const desc = await describeImage(buf, mime);
  if (!desc) return null;
  // Cap the context line regardless of path: a full-page transcription can be
  // far longer than the chat context budget.
  return `【图片内容】${desc.text.slice(0, CONTEXT_MAX_CHARS)}`;
}
