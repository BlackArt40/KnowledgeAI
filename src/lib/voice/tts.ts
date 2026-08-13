// ---------------------------------------------------------------------------
// Text-to-speech (P7-4): Web Speech API speechSynthesis wrapper - read an
// assistant answer aloud. Injectable for unit tests; graceful when the API is
// missing (headless/unsupported browsers).
// ---------------------------------------------------------------------------

export interface TtsCallbacks {
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export interface SynthesisLike {
  speak(utterance: unknown): void;
  cancel(): void;
  getVoices(): { lang: string; name: string }[];
  speaking: boolean;
}

export function isTtsSupported(win?: Window): boolean {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  return !!w && typeof w.speechSynthesis !== "undefined";
}

export function ttsLang(locale: string): string {
  return locale === "en" ? "en-US" : "zh-CN";
}

/**
 * Speak `text` aloud. Cancels any current utterance first (one voice at a
 * time). Returns a cancel() handle. No-op when unsupported.
 */
export function speakText(
  text: string,
  locale: string,
  synthesis: SynthesisLike,
  callbacks: TtsCallbacks = {}
): { cancel: () => void } {
  if (!text || !synthesis) return { cancel: () => {} };

  const UtteranceCtor = (globalThis as { SpeechSynthesisUtterance?: new () => { text: string; lang: string; rate: number; pitch: number; volume: number; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null } }).SpeechSynthesisUtterance;
  if (!UtteranceCtor) return { cancel: () => {} };

  synthesis.cancel(); // stop whatever is playing
  const utter = new UtteranceCtor();
  utter.text = text;
  utter.lang = ttsLang(locale);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  utter.onend = () => callbacks.onEnd?.();
  utter.onerror = (e) => callbacks.onError?.(e.error ?? "tts-error");

  try {
    synthesis.speak(utter);
  } catch {
    callbacks.onError?.("speak-failed");
  }

  return { cancel: () => synthesis.cancel() };
}
