// P7-4 unit tests: image description (vision LLM path + OCR demo path).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { llmEnabled, ocrResult, chatResult } = vi.hoisted(() => ({
  llmEnabled: { value: false },
  ocrResult: { value: "这是一段 OCR 识别的图片文字：星辰协议 v2" },
  chatResult: { value: "一张产品架构图，包含星辰协议 v2 的模块划分。" },
}));

vi.mock("@/lib/llm/provider", () => ({
  isLLMEnabled: async () => llmEnabled.value,
  chatComplete: async () => chatResult.value,
}));

vi.mock("./ocr", () => ({
  ocrImage: async () => ocrResult.value,
}));

import { describeImage, imageContextLine } from "./vision";

// a 1x1 png (valid header) so @napi-rs/canvas loadImage succeeds
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

beforeEach(() => {
  llmEnabled.value = false;
  ocrResult.value = "这是一段 OCR 识别的图片文字：星辰协议 v2";
  chatResult.value = "一张产品架构图，包含星辰协议 v2 的模块划分。";
});

describe("describeImage", () => {
  it("demo path: returns OCR text + dimensions (source=ocr)", async () => {
    const desc = await describeImage(TINY_PNG, "image/png");
    expect(desc).not.toBeNull();
    expect(desc!.text).toContain("星辰协议");
    expect(desc!.source).toBe("ocr");
    expect(desc!.width).toBeGreaterThan(0);
  });

  it("LLM path: vision description wins over OCR (source=vision)", async () => {
    llmEnabled.value = true;
    const desc = await describeImage(TINY_PNG, "image/png");
    expect(desc!.text).toBe(chatResult.value);
    expect(desc!.source).toBe("vision");
  });

  it("LLM path falls back to OCR when the model returns nothing", async () => {
    llmEnabled.value = true;
    chatResult.value = "";
    const desc = await describeImage(TINY_PNG, "image/png");
    expect(desc!.source).toBe("ocr");
    expect(desc!.text).toContain("星辰协议");
  });

  it("falls back to a dimensions placeholder when both paths yield nothing", async () => {
    ocrResult.value = "";
    const desc = await describeImage(TINY_PNG, "image/png");
    expect(desc!.text).toContain("图片");
    expect(desc!.width).toBeGreaterThan(0);
  });
});

describe("imageContextLine", () => {
  it("wraps the description for the chat query context", async () => {
    const line = await imageContextLine(TINY_PNG, "image/png");
    expect(line).toContain("【图片内容】");
    expect(line).toContain("星辰协议");
  });

  it("still produces a context line for undescribable images (dimensions)", async () => {
    ocrResult.value = "";
    const line = await imageContextLine(TINY_PNG, "image/png");
    expect(line).toContain("【图片内容】");
  });
});
