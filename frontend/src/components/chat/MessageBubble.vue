<script setup lang="ts">
// 消息气泡（V4，复刻 src/components/app/chat/message-bubble.tsx）：
// 用户右对齐纯文本；助手 markdown（@/lib/markdown，[n]→引用 chip，容器
// click 委托读 data-cite）+ 流式光标 + 操作行（复制/重新生成/朗读 TTS/
// 点赞/点踩+备注）。V8 补齐朗读：@shared/voice/tts 单源复用，不支持的
// 浏览器（headless）按钮按设计隐藏。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  MagicStick,
  Check,
  CopyDocument,
  RefreshRight,
  Select,
  CloseBold,
  Reading,
} from "@element-plus/icons-vue";
import { renderChatMarkdown } from "@/lib/markdown";
import { useSpeechSynthesis } from "@/lib/use-speech";
import type { Citation } from "@/api/chat";

const props = defineProps<{
  msg: {
    id: string;
    role: "user" | "assistant";
    content: string;
    citations?: Citation[];
    streaming?: boolean;
    feedback?: "up" | "down";
    feedbackNote?: string;
    followUps?: string[];
  };
}>();
const emit = defineEmits<{
  (e: "cite", n: number): void;
  (e: "regenerate"): void;
  (e: "feedback", v: "up" | "down", note?: string): void;
}>();
const { t } = useTranslation();

const html = computed(() => renderChatMarkdown(props.msg.content));
const copied = ref(false);
const noteOpen = ref(false);
const note = ref("");
// V8：朗读回答（TTS）——一次一路，speak 前自动 cancel；朗读内容剥 [n] 引用标记
const { supported: ttsSupported, speaking: ttsSpeaking, speak: ttsSpeak, cancel: ttsCancel } = useSpeechSynthesis();

function copyContent() {
  void navigator.clipboard?.writeText(props.msg.content.replace(/\[\d+\]/g, ""));
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function onBodyClick(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest("[data-cite]");
  if (el) emit("cite", Number((el as HTMLElement).dataset.cite));
}

function submitNote() {
  emit("feedback", "down", note.value.trim());
  noteOpen.value = false;
  note.value = "";
}

function cancelNote() {
  noteOpen.value = false;
  note.value = "";
}
</script>

<template>
  <div
    v-if="msg.role === 'user'"
    class="row user"
  >
    <div class="bubble-user">
      {{ msg.content }}
    </div>
  </div>
  <div
    v-else
    class="row ai"
  >
    <span class="avatar">
      <el-icon :size="14">
        <MagicStick />
      </el-icon>
    </span>
    <div class="col">
      <div
        class="bubble-ai"
        @click="onBodyClick"
      >
        <!-- markdown-it html:false 净化后的输出（eslint 豁免有据） -->
        <div
          class="md"
          v-html="html"
        />
        <span
          v-if="msg.streaming"
          class="cursor"
        />
      </div>
      <div
        v-if="!msg.streaming && msg.content"
        class="actions"
      >
        <button
          type="button"
          class="act"
          :class="{ on: copied }"
          @click="copyContent"
        >
          <el-icon :size="11">
            <component :is="copied ? Check : CopyDocument" />
          </el-icon>
          {{ copied ? t("page.chat.s35") : t("page.chat.s36") }}
        </button>
        <button
          type="button"
          class="act"
          @click="emit('regenerate')"
        >
          <el-icon :size="11">
            <RefreshRight />
          </el-icon>
          {{ t("page.chat.s37") }}
        </button>
        <!-- V8：朗读回答（TTS） -->
        <button
          v-if="ttsSupported"
          type="button"
          class="act"
          :class="{ on: ttsSpeaking }"
          @click="ttsSpeaking ? ttsCancel() : ttsSpeak(msg.content.replace(/\[\d+\]/g, ''))"
        >
          <el-icon :size="11">
            <Reading />
          </el-icon>
          {{ ttsSpeaking ? t("page.chat.s86") : t("page.chat.s85") }}
        </button>
        <button
          type="button"
          class="act"
          :class="{ on: msg.feedback === 'up' }"
          @click="emit('feedback', 'up')"
        >
          <el-icon :size="11">
            <Select />
          </el-icon>
          {{ t("page.chat.s38") }}
        </button>
        <button
          type="button"
          class="act"
          :class="{ on: msg.feedback === 'down' }"
          @click="msg.feedback === 'down' ? emit('feedback', 'down') : (noteOpen = true)"
        >
          <el-icon :size="11">
            <CloseBold />
          </el-icon>
          {{ t("page.chat.s39") }}
        </button>
        <div
          v-if="noteOpen"
          class="note-row"
        >
          <input
            v-model="note"
            class="note-input"
            :placeholder="t('page.chat.s40')"
            @keydown.enter="submitNote"
          >
          <button
            type="button"
            class="note-submit"
            @click="submitNote"
          >
            {{ t("common.submit") }}
          </button>
          <button
            type="button"
            class="note-cancel"
            @click="cancelNote"
          >
            {{ t("common.cancel") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
}
.row.user {
  justify-content: flex-end;
}
.row.ai {
  align-items: flex-start;
}
.avatar {
  display: flex;
  height: 32px;
  width: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border-radius: 10px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.bubble-user {
  max-width: 80%;
  padding: 10px 16px;
  border-radius: 16px 4px 16px 16px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  word-break: break-word;
}
.col {
  min-width: 0;
  max-width: 85%;
}
.bubble-ai {
  padding: 12px 16px;
  border-radius: 4px 16px 16px 16px;
  background: hsl(var(--muted));
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}
.cursor {
  display: inline-block;
  height: 16px;
  width: 6px;
  margin-left: 2px;
  vertical-align: middle;
  background: hsl(var(--primary));
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
/* markdown 基线样式（chat 与 agent 报告共用 .md 约定） */
.md :deep(h1),
.md :deep(h2),
.md :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
}
.md :deep(p) {
  margin: 6px 0;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.md :deep(pre) {
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: hsl(var(--card));
  font-size: 12px;
}
.md :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
}
.md :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 5px 9px;
  text-align: left;
}
.md :deep(blockquote) {
  margin: 8px 0;
  padding-left: 10px;
  border-left: 3px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
}
/* [n] 引用 chip（renderChatMarkdown 注入，click 委托上报） */
.md :deep(.cite-chip) {
  display: inline-flex;
  height: 15px;
  min-width: 15px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  margin: 0 1px;
  border: 0;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
  vertical-align: 1px;
}
.md :deep(.cite-chip:hover) {
  background: hsl(var(--primary) / 0.3);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 0 4px;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.act:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.act.on {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.note-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
}
.note-input {
  height: 32px;
  min-width: 0;
  flex: 1;
  padding: 0 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  font: inherit;
  font-size: 12px;
}
.note-input:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
}
.note-submit {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.note-cancel {
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.note-cancel:hover {
  color: hsl(var(--foreground));
}
</style>
