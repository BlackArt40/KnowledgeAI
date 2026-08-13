"use client";

// P7-4: voice output hook - wraps src/lib/voice/tts: speak/cancel a text,
// tracks whether it is currently reading aloud.

import * as React from "react";
import { useLocale } from "@/lib/i18n/provider";
import { speakText, isTtsSupported, type SynthesisLike } from "@/lib/voice/tts";

export function useSpeechSynthesis() {
  const locale = useLocale();
  const [speaking, setSpeaking] = React.useState(false);
  const cancelRef = React.useRef<{ cancel: () => void } | null>(null);

  const supported = React.useMemo(() => isTtsSupported(), []);

  React.useEffect(() => {
    return () => cancelRef.current?.cancel();
  }, []);

  const speak = React.useCallback(
    (text: string) => {
      if (!text || !supported) return;
      const synthesis = window.speechSynthesis as unknown as SynthesisLike;
      cancelRef.current = speakText(text, locale, synthesis, {
        onEnd: () => {
          setSpeaking(false);
          cancelRef.current = null;
        },
        onError: () => {
          setSpeaking(false);
          cancelRef.current = null;
        },
      });
      setSpeaking(true);
    },
    [locale, supported]
  );

  const cancel = React.useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, cancel };
}
