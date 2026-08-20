"use client";

// P7-4: voice input hook - wraps src/lib/voice/stt with React state:
// listening flag + interim transcript. Unsupported browsers report false.

import * as React from "react";
import { useLocale } from "@/lib/i18n/provider";
import {
  recognitionCtor,
  startListening,
  isSttSupported,
  type SttCallbacks,
} from "@/lib/voice/stt";

export function useSpeechRecognition(opts: {
  onFinalText: (text: string) => void;
  onError?: (error: string) => void;
}) {
  const locale = useLocale();
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const stopRef = React.useRef<{ stop: () => void } | null>(null);

  // M-12: `supported` must be false on BOTH the server render and the
  // client's first paint - isSttSupported() reads `window`, which SSR lacks.
  // useSyncExternalStore is the canonical fix: the server snapshot is always
  // false (hydration matches), and the client snapshot runs only after
  // hydration so the value flips false -> true without a mismatch. (The naive
  // useState(false)+useEffect is rejected by the react-hooks lint rule for
  // synchronous setState-in-effect cascading renders.)
  const supported = React.useSyncExternalStore(
    () => () => {},
    () => isSttSupported(),
    () => false
  );

  React.useEffect(() => {
    return () => stopRef.current?.stop();
  }, []);

  const start = React.useCallback(() => {
    const ctor = recognitionCtor();
    if (!ctor) {
      opts.onError?.("unsupported");
      return;
    }
    if (stopRef.current) stopRef.current.stop();
    setInterim("");
    const callbacks: SttCallbacks = {
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        if (t.trim()) opts.onFinalText(t.trim());
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
        stopRef.current = null;
      },
      onError: (e) => {
        setListening(false);
        setInterim("");
        stopRef.current = null;
        opts.onError?.(e);
      },
    };
    stopRef.current = startListening(ctor, locale, callbacks);
    setListening(true);
  }, [locale, opts]);

  const stop = React.useCallback(() => {
    stopRef.current?.stop();
  }, []);

  return { listening, interim, supported, start, stop };
}
