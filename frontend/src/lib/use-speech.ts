// P7-4 → V8：语音输入/朗读 composables —— 包装 @shared/voice/{stt,tts}
// （框架无关可注入纯封装，单源零拷贝复用），等价退役的 Next hooks
// （src/hooks/use-speech-*.ts）。不支持的浏览器（headless/无 Web Speech）
// supported=false，控件按设计隐藏；locale 在 start/speak 调用时实时读取
// 共享 i18next 实例（切语言后无需重建组件）。
import { onBeforeUnmount, ref } from "vue";
import { getI18nInstance } from "@shared/i18n/translate";
import {
  isSttSupported,
  recognitionCtor,
  startListening,
  type SttCallbacks,
} from "@shared/voice/stt";
import { isTtsSupported, speakText, type SynthesisLike } from "@shared/voice/tts";

function currentLocale(): string {
  return getI18nInstance().language || "zh-CN";
}

/** 语音输入：listening 状态 + 中间转写 + 终稿回调（终稿即发送）。 */
export function useSpeechRecognition(opts: {
  onFinalText: (text: string) => void;
  onError?: (error: string) => void;
}) {
  const supported = isSttSupported();
  const listening = ref(false);
  const interim = ref("");
  let stopHandle: { stop: () => void } | null = null;

  function reset() {
    listening.value = false;
    interim.value = "";
    stopHandle = null;
  }

  function start() {
    const ctor = recognitionCtor();
    if (!ctor) {
      opts.onError?.("unsupported");
      return;
    }
    stopHandle?.stop();
    interim.value = "";
    const callbacks: SttCallbacks = {
      onInterim: (t) => (interim.value = t),
      onFinal: (t) => {
        if (t.trim()) opts.onFinalText(t.trim());
      },
      onEnd: reset,
      onError: (e) => {
        reset();
        opts.onError?.(e);
      },
    };
    stopHandle = startListening(ctor, currentLocale(), callbacks);
    listening.value = true;
  }

  function stop() {
    stopHandle?.stop();
  }

  onBeforeUnmount(() => stopHandle?.stop());

  return { supported, listening, interim, start, stop };
}

/** 朗读：speak/cancel 一段文本（一次一路，先 cancel 再 speak）。 */
export function useSpeechSynthesis() {
  const supported = isTtsSupported();
  const speaking = ref(false);
  let cancelHandle: { cancel: () => void } | null = null;

  function speak(text: string) {
    if (!text || !supported) return;
    const synthesis = window.speechSynthesis as unknown as SynthesisLike;
    cancelHandle = speakText(text, currentLocale(), synthesis, {
      onEnd: () => {
        speaking.value = false;
        cancelHandle = null;
      },
      onError: () => {
        speaking.value = false;
        cancelHandle = null;
      },
    });
    speaking.value = true;
  }

  function cancel() {
    cancelHandle?.cancel();
    cancelHandle = null;
    speaking.value = false;
  }

  onBeforeUnmount(() => cancelHandle?.cancel());

  return { supported, speaking, speak, cancel };
}
