// ---------------------------------------------------------------------------
// Image description (P7-4) - used by:
//   - parseImage: appends a vision description to the OCR text so image
//     documents carry a caption and are retrievable by visual content
//   - chat multimodal: describes user-uploaded images (demo mode) so the
//     answer can reference the image content
//
// Two paths:
//   - LLM configured (isLLMEnabled): chatComplete with OpenAI content parts
//     (text + image_url base64) -> natural-language description
//   - demo fallback: OCR the image (tesseract) + dimensions via @napi-rs/canvas
//     -> deterministic, offline, works without any provider
// ---------------------------------------------------------------------------

import { isLLMEnabled, chatComplete } from "@/lib/llm/provider";
import { ocrImage } from "./ocr";

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
            content: "请用中文简要描述这张图片的内容（40 字以内，聚焦可检索的关键信息）。",
            images: [{ mime, data }],
          },
        ],
        { temperature: 0.2, maxTokens: 120 }
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
  if (desc.source === "ocr" && desc.text.length > 2000) {
    return `【图片内容】${desc.text.slice(0, 2000)}`;
  }
  return `【图片内容】${desc.text}`;
}
