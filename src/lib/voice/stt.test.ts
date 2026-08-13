// P7-4 unit tests: speech-to-text wrapper with a mock recognition.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startListening,
  recognitionCtor,
  isSttSupported,
  sttLang,
  type SpeechRecognitionLike,
} from "./stt";

/** A scripted mock recognition: the test drives onresult/onend manually. */
function mockRecognition(): SpeechRecognitionLike & { events: Record<string, unknown> } {
  const events: Record<string, unknown> = {};
  return {
    lang: "",
    continuous: false,
    interimResults: false,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    events,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("stt", () => {
  it("maps locale to recognition lang (zh-CN / en-US)", () => {
    expect(sttLang("zh-CN")).toBe("zh-CN");
    expect(sttLang("en")).toBe("en-US");
  });

  it("detects support via the browser constructors", () => {
    expect(isSttSupported({ SpeechRecognition: mockRecognition } as unknown as Window)).toBe(true);
    expect(isSttSupported({ webkitSpeechRecognition: mockRecognition } as unknown as Window)).toBe(true);
    expect(isSttSupported({} as Window)).toBe(false);
    expect(recognitionCtor({} as Window)).toBeNull();
  });

  it("delivers interim + final transcripts and stops cleanly", () => {
    const rec = mockRecognition();
    const interim = vi.fn();
    const final = vi.fn();
    const ended = vi.fn();
    const handle = startListening(() => rec, "zh-CN", {
      onInterim: interim,
      onFinal: final,
      onEnd: ended,
    });

    expect(rec.lang).toBe("zh-CN");
    expect(rec.start).toHaveBeenCalledTimes(1);

    // interim result (resultIndex 0, non-final)
    rec.onresult!({
      resultIndex: 0,
      results: {
        length: 1,
        item: () => ({ transcript: "你好", confidence: 0.9, isFinal: false }),
      },
    });
    expect(interim).toHaveBeenCalledWith("你好");
    expect(final).not.toHaveBeenCalled();

    // final result
    rec.onresult!({
      resultIndex: 0,
      results: {
        length: 1,
        item: () => ({ transcript: "你好世界", confidence: 0.95, isFinal: true }),
      },
    });
    expect(final).toHaveBeenCalledWith("你好世界");

    rec.onend!();
    expect(ended).toHaveBeenCalled();

    handle.stop();
    expect(rec.stop).toHaveBeenCalled();
  });

  it("reports recognition errors", () => {
    const rec = mockRecognition();
    const onError = vi.fn();
    startListening(() => rec, "zh-CN", { onError });
    rec.onerror!({ error: "no-speech" });
    expect(onError).toHaveBeenCalledWith("no-speech");
  });

  it("survives a start() throw", () => {
    const rec = mockRecognition();
    (rec.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("not-allowed");
    });
    const onError = vi.fn();
    startListening(() => rec, "zh-CN", { onError });
    expect(onError).toHaveBeenCalledWith("start-failed");
  });
});
