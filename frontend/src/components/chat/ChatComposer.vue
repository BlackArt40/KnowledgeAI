<script setup lang="ts">
// 输入区：联网开关、图片附件、语音输入、发送/停止。文件选择与语音状态由
// 父视图持有，本组件只负责交互事件与 textarea 展示（含 STT 中间转写）。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Compass, Microphone, Picture, Promotion, VideoPause } from "@element-plus/icons-vue";

interface Attachment {
  mime: string;
  data: string;
  name: string;
}

const props = defineProps<{
  modelValue: string;
  sending: boolean;
  webSearch: boolean;
  attachments: Attachment[];
  sttSupported: boolean;
  sttListening: boolean;
  sttInterim: string;
  placeholder: string;
  sendDisabled: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:web-search": [value: boolean];
  send: [];
  stop: [];
  attach: [files: FileList];
  "remove-attachment": [index: number];
  "toggle-stt": [];
  keydown: [event: KeyboardEvent];
}>();

const { t } = useTranslation();
const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

const displayValue = computed(() =>
  props.sttListening
    ? (props.modelValue ? `${props.modelValue} ${props.sttInterim}` : props.sttInterim)
    : props.modelValue
);

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function onFileChange(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (files && files.length > 0) emit("attach", files);
  (event.target as HTMLInputElement).value = "";
}

function onKeydown(event: KeyboardEvent) {
  emit("keydown", event);
}

defineExpose({
  focus: () => textarea.value?.focus(),
});
</script>

<template>
  <div class="composer">
    <div class="ws-row">
      <button
        type="button"
        class="ws-toggle"
        :class="{ on: webSearch }"
        :aria-pressed="webSearch"
        :title="webSearch ? t('page.chat.s26') : t('page.chat.s27')"
        @click="emit('update:web-search', !webSearch)"
      >
        <el-icon :size="12">
          <Compass />
        </el-icon>
        {{ t("page.chat.s74") }}
      </button>
      <span
        v-if="webSearch"
        class="ws-hint"
      >{{ t("page.chat.s4") }}</span>
    </div>
    <div
      v-if="attachments.length > 0"
      class="attach-row"
    >
      <div
        v-for="(img, i) in attachments"
        :key="i"
        class="attach"
      >
        <img
          :src="`data:${img.mime};base64,${img.data}`"
          :alt="img.name"
        >
        <button
          type="button"
          class="attach-x"
          :aria-label="t('page.chat.s64')"
          @click="emit('remove-attachment', i)"
        >
          ×
        </button>
      </div>
    </div>
    <div class="input-box">
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="file-hidden"
        @change="onFileChange"
      >
      <button
        type="button"
        class="icon-btn"
        :aria-label="t('page.chat.s65')"
        :title="t('page.chat.s65')"
        @click="fileInput?.click()"
      >
        <el-icon :size="14">
          <Picture />
        </el-icon>
      </button>
      <button
        v-if="sttSupported"
        type="button"
        class="icon-btn"
        :class="{ listening: sttListening }"
        :aria-label="sttListening ? t('page.chat.s84') : t('page.chat.s83')"
        :title="sttListening ? t('page.chat.s84') : t('page.chat.s83')"
        @click="emit('toggle-stt')"
      >
        <el-icon :size="14">
          <Microphone />
        </el-icon>
      </button>
      <textarea
        ref="textarea"
        rows="1"
        class="ask-input"
        :value="displayValue"
        :placeholder="placeholder"
        :aria-label="placeholder"
        @keydown="onKeydown"
        @input="onInput"
      />
      <button
        v-if="sending"
        type="button"
        class="send-btn stop"
        :aria-label="t('page.chat.s30')"
        @click="emit('stop')"
      >
        <el-icon :size="14">
          <VideoPause />
        </el-icon>
      </button>
      <button
        v-else
        type="button"
        class="send-btn"
        :disabled="sendDisabled"
        :aria-label="t('page.chat.s31')"
        @click="emit('send')"
      >
        <el-icon :size="14">
          <Promotion />
        </el-icon>
      </button>
    </div>
  </div>
</template>
