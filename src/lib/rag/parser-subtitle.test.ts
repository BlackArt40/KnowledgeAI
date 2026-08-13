// P7-4 unit tests: subtitle (.srt/.vtt) parsing - timestamps/tags stripped.
import { describe, it, expect, vi, beforeEach } from "vitest";

// parser.ts pulls in ocr (tesseract) + vision (canvas) lazily - only the
// subtitle path is exercised here, so mock the heavy deps.
vi.mock("./ocr", () => ({ ocrImage: async () => null }));
vi.mock("./vision", () => ({ describeImage: async () => null }));
vi.mock("@/lib/obs/log", () => ({ log: { warn: () => {}, error: () => {}, info: () => {} } }));

import { parseDocument } from "./parser";

beforeEach(() => {
  vi.resetModules();
});

describe("parseSubtitle (.srt / .vtt)", () => {
  it("strips cue indexes + timestamps, keeps dialogue text (srt)", async () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
大家好，欢迎收看本期节目

2
00:00:05,000 --> 00:00:08,500
今天我们来聊聊星辰协议

`;
    const parsed = await parseDocument(Buffer.from(srt), "demo.srt", "subtitle");
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toContain("大家好，欢迎收看本期节目");
    expect(parsed!.text).toContain("星辰协议");
    expect(parsed!.text).not.toMatch(/\d{2}:\d{2}/);
    expect(parsed!.text).not.toMatch(/^\d+$/m);
  });

  it("strips inline tags + WEBVTT header (vtt)", async () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<i>星辰科技</i> 发布了新一代产品

NOTE 这是一条注释
00:00:04.000 --> 00:00:06.000
支持 &amp; 增强功能
`;
    const parsed = await parseDocument(Buffer.from(vtt), "demo.vtt", "subtitle");
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toContain("星辰科技 发布了新一代产品");
    expect(parsed!.text).toContain("支持 & 增强功能");
    expect(parsed!.text).not.toContain("<i>");
    expect(parsed!.text).not.toContain("WEBVTT");
  });

  it("returns null for empty/garbage subtitles", async () => {
    const parsed = await parseDocument(Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), "x.srt", "subtitle");
    expect(parsed).toBeNull();
  });

  it("docTypeFromName maps srt/vtt (via kb/store)", async () => {
    const { docTypeFromName } = await import("@/lib/kb/store");
    expect(docTypeFromName("movie.srt")).toBe("subtitle");
    expect(docTypeFromName("talk.vtt")).toBe("subtitle");
    expect(docTypeFromName("notes.txt")).toBe("text");
  });
});
