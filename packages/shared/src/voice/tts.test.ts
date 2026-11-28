// P7-4 unit tests: text-to-speech wrapper with a mock synthesis.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { speakText, isTtsSupported, ttsLang, type SynthesisLike } from "./tts";

class MockUtterance {
  text = "";
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
}

beforeEach(() => {
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
});

describe("tts", () => {
  it("maps locale to speech lang", () => {
    expect(ttsLang("zh-CN")).toBe("zh-CN");
    expect(ttsLang("en")).toBe("en-US");
  });

  it("detects support", () => {
    expect(isTtsSupported({ speechSynthesis: {} } as Window)).toBe(true);
    expect(isTtsSupported({} as Window)).toBe(false);
  });

  it("speaks text with the right lang and cancels the previous utterance", () => {
    const spoken: { text: string; lang: string }[] = [];
    let cancelCount = 0;
    const synthesis: SynthesisLike = {
      cancel: () => { cancelCount++; },
      getVoices: () => [],
      speaking: false,
      speak: (u) => spoken.push(u as { text: string; lang: string }),
    };

    const endCb = vi.fn();
    const { cancel } = speakText("你好，这是一段回答", "zh-CN", synthesis, { onEnd: endCb });
    expect(spoken.length).toBe(1);
    expect(spoken[0].text).toBe("你好，这是一段回答");
    expect(spoken[0].lang).toBe("zh-CN");
    // each speakText cancels whatever is playing first
    expect(cancelCount).toBe(1);
    // speaking a second text cancels the first
    speakText("第二条", "zh-CN", synthesis);
    expect(cancelCount).toBe(2);
    expect(spoken.length).toBe(2);

    cancel();
    expect(cancelCount).toBe(3);
  });

  it("no-op without an utterance constructor or empty text", () => {
    const synthesis: SynthesisLike = { cancel: vi.fn(), getVoices: () => [], speaking: false, speak: vi.fn() };
    const noop = speakText("", "zh-CN", synthesis);
    noop.cancel();
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it("reports speak failures", () => {
    const synthesis: SynthesisLike = {
      cancel: () => {},
      getVoices: () => [],
      speaking: false,
      speak: () => { throw new Error("boom"); },
    };
    const onError = vi.fn();
    speakText("test", "zh-CN", synthesis, { onError });
    expect(onError).toHaveBeenCalledWith("speak-failed");
  });
});
