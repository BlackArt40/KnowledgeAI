<script setup lang="ts">
import { useTranslation } from "i18next-vue";

const { t } = useTranslation();
defineProps<{
  modelValue: boolean;
  confirm: string;
  deleting: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  "update:confirm": [string];
  confirm: [];
}>();
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('page.settings.s9')"
    width="420px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="hint">
      {{ t("page.settings.s94") }}<strong>{{ t("page.settings.s35") }}</strong>。
    </p>
    <div class="alert-box">
      {{ t("page.settings.s95") }}
    </div>
    <label class="field">
      <span class="label">{{ t("page.settings.s10") }}<strong>DELETE</strong>{{ t("page.settings.s11") }}</span>
      <el-input
        :model-value="confirm"
        placeholder="DELETE"
        @update:model-value="emit('update:confirm', $event)"
      />
    </label>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">
        {{ t("page.settings.s38") }}
      </el-button>
      <el-button
        type="danger"
        :disabled="deleting || confirm !== 'DELETE'"
        :loading="deleting"
        @click="emit('confirm')"
      >
        {{ t("page.settings.s96") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="../settings.css"></style>
