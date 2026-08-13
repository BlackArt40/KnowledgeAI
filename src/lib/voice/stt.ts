// ---------------------------------------------------------------------------
// Speech-to-text (P7-4): Web Speech API wrapper (webkitSpeechRecognition /
// SpeechRecognition). Injectable constructor + locale + callbacks so unit
// tests can drive it with a mock. Gracefully reports unsupported browsers.
// ---------------------------------------------------------------------------

export interface SttCallbacks {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export type RecognitionCtor = () => SpeechRecognitionLike;

/** Pick the browser's recognition constructor (webkit prefix first). */
export function recognitionCtor(win?: Window): RecognitionCtor | null {
  const w = (win ?? (typeof window !== "undefined" ? window : undefined)) as
    (Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }) | undefined;
  if (!w) return null; // SSR / non-browser
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? (() => new Ctor() as unknown as SpeechRecognitionLike) : null;
}

export function isSttSupported(win?: Window): boolean {
  return recognitionCtor(win) !== null;
}

/** Map the browser locale (zh-CN/en) to a recognition lang. */
export function sttLang(locale: string): string {
  return locale === "en" ? "en-US" : "zh-CN";
}

/**
 * Start listening. Returns a stop() function.
 * final/onFinal text is delivered on the recognition's final results.
 */
export function startListening(
  ctor: RecognitionCtor,
  locale: string,
  callbacks: SttCallbacks
): { stop: () => void } {
  const rec = ctor();
  rec.lang = sttLang(locale);
  rec.continuous = false;
  rec.interimResults = true;

  const eventOf = (ev: unknown) => ev as {
    resultIndex: number;
    results: { length: number; item(i: number): { transcript: string; confidence: number; isFinal: boolean }; [i: number]: { transcript: string; isFinal: boolean } };
  };

  rec.onresult = (ev) => {
    const event = eventOf(ev);
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results.item(i);
      const transcript = r.transcript ?? event.results[i]?.transcript ?? "";
      if (r.isFinal || event.results[i]?.isFinal) final += transcript;
      else interim += transcript;
    }
    if (interim) callbacks.onInterim?.(interim);
    if (final) callbacks.onFinal?.(final);
  };
  rec.onerror = (ev) => {
    const error = (ev as { error?: string }).error ?? "unknown";
    callbacks.onError?.(error);
  };
  rec.onend = () => callbacks.onEnd?.();

  try {
    rec.start();
  } catch {
    callbacks.onError?.("start-failed");
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        rec.abort();
      }
    },
  };
}
