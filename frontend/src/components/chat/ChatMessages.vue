<script setup lang="ts">
// 消息列表 + 追问建议 + 相关知识库推荐（空态由父视图负责）。
import { useTranslation } from "i18next-vue";
import { Collection, MagicStick } from "@element-plus/icons-vue";
import MessageBubble from "@/components/chat/MessageBubble.vue";
import type { ChatMsg, ChatRecommendation } from "@/lib/chat-types";

const props = defineProps<{
  messages: ChatMsg[];
  lastFollowUps: string[];
  recommendations: ChatRecommendation[];
}>();

const emit = defineEmits<{
  cite: [n: number];
  regenerate: [];
  feedback: [id: string, value: "up" | "down", note?: string];
  pick: [text: string];
  "select-recommendation": [id: string];
}>();

const { t } = useTranslation();
</script>

<template>
  <template
    v-for="(m, i) in props.messages"
    :key="m.id"
  >
    <MessageBubble
      :msg="m"
      @cite="emit('cite', $event)"
      @regenerate="emit('regenerate')"
      @feedback="(v, note) => emit('feedback', m.id, v, note)"
    />
    <div
      v-if="props.lastFollowUps.length > 0 && i === props.messages.length - 1"
      class="followups"
    >
      <span class="fu-label">
        <el-icon :size="11">
          <MagicStick />
        </el-icon>
        {{ t("page.chat.s82") }}
      </span>
      <button
        v-for="(s, fi) in props.lastFollowUps"
        :key="fi"
        type="button"
        class="sug"
        @click="emit('pick', s)"
      >
        {{ s }}
      </button>
    </div>
  </template>

  <div
    v-if="props.messages.length > 0 && props.recommendations.length > 0"
    class="rec-block"
  >
    <p class="rec-head">
      <el-icon
        :size="12"
        class="rec-ico"
      >
        <MagicStick />
      </el-icon>
      {{ t("page.chat.s72") }}
    </p>
    <button
      v-for="r in props.recommendations"
      :key="r.id"
      type="button"
      class="rec-item"
      @click="emit('select-recommendation', r.id)"
    >
      <el-icon
        :size="13"
        class="rec-ico"
      >
        <Collection />
      </el-icon>
      <span class="rec-main">
        <span class="rec-name">{{ r.name }}</span>
        <span class="rec-desc">{{ r.desc || t("page.chat.s25") }}</span>
      </span>
      <span class="rec-terms">{{ t("page.chat.s73", { terms: r.matched.join(t("page.chat.s77")) }) }}</span>
    </button>
  </div>
</template>
