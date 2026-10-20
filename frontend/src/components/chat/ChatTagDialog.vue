<script setup lang="ts">
// 会话标签编辑对话框；草稿状态由组件自持，保存时一次性提交。
import { ref, watch } from "vue";
import { useTranslation } from "i18next-vue";

const props = defineProps<{
  open: boolean;
  title: string;
  tags: string[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  save: [tags: string[]];
}>();

const { t } = useTranslation();
const tagDraft = ref<string[]>([]);
const tagInput = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      tagDraft.value = [...props.tags];
      tagInput.value = "";
    }
  },
  { immediate: true }
);

function addTag() {
  const tag = tagInput.value.trim().replace(/^#/, "");
  if (tag && !tagDraft.value.includes(tag)) tagDraft.value = [...tagDraft.value, tag];
  tagInput.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag();
  } else if (e.key === "Backspace" && !tagInput.value && tagDraft.value.length > 0) {
    tagDraft.value = tagDraft.value.slice(0, -1);
  }
}
</script>

<template>
  <el-dialog
    :model-value="props.open"
    :title="t('page.chat.s6')"
    width="400px"
    @update:model-value="emit('update:open', $event)"
  >
    <p class="dialog-desc">
      {{ t("page.chat.s75", { title: props.title }) }}
    </p>
    <div class="tag-editor">
      <span
        v-for="tag in tagDraft"
        :key="tag"
        class="tag-chip"
      >
        #{{ tag }}
        <button
          type="button"
          class="tag-x"
          :aria-label="t('page.chat.s58', { tag })"
          @click="tagDraft = tagDraft.filter((x) => x !== tag)"
        >
          ×
        </button>
      </span>
      <input
        v-model="tagInput"
        class="tag-input"
        :placeholder="t('page.chat.s48')"
        @keydown="onKeydown"
      >
    </div>
    <template #footer>
      <el-button @click="emit('update:open', false)">
        {{ t("common.cancel") }}
      </el-button>
      <el-button
        type="primary"
        @click="emit('save', tagDraft); emit('update:open', false)"
      >
        {{ t("page.chat.s79") }}
      </el-button>
    </template>
  </el-dialog>
</template>
