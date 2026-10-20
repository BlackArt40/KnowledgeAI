<script setup lang="ts">
// 空会话引导：有就绪文档时展示建议问题，否则引导去上传。
import { useTranslation } from "i18next-vue";
import { MagicStick } from "@element-plus/icons-vue";

defineProps<{
  hasReady: boolean;
  suggestions: string[];
}>();

const emit = defineEmits<{ pick: [text: string] }>();
const { t } = useTranslation();
</script>

<template>
  <div class="empty-state">
    <span class="empty-ava">
      <el-icon :size="24">
        <MagicStick />
      </el-icon>
    </span>
    <h3>{{ t("page.chat.s8") }}</h3>
    <p>{{ hasReady ? t("page.chat.s33") : t("page.chat.s34") }}</p>
    <div
      v-if="hasReady"
      class="sug-list"
    >
      <button
        v-for="s in suggestions"
        :key="s"
        type="button"
        class="sug"
        @click="emit('pick', s)"
      >
        {{ s }}
      </button>
    </div>
    <router-link
      v-else
      to="/knowledge-base"
      class="go-kb"
    >
      {{ t("page.chat.s9") }}
    </router-link>
  </div>
</template>
