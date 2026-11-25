<script setup lang="ts">
import { ref } from "vue";
import { useTranslation } from "i18next-vue";
import { UploadFilled } from "@element-plus/icons-vue";
import { ApiError } from "@/api/client";
import { uploadDocs } from "@/api/kb";

const { t } = useTranslation();
const props = defineProps<{ kbId: string }>();
const emit = defineEmits<{ uploaded: [] }>();

const uploading = ref(false);
const uploadErrors = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

function pickFiles() {
  fileInput.value?.click();
}
async function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  uploading.value = true;
  uploadErrors.value = [];
  try {
    const r = await uploadDocs(props.kbId, files);
    uploadErrors.value = r.errors ?? [];
    emit("uploaded");
  } catch (err) {
    uploadErrors.value = [err instanceof ApiError && err.message ? err.message : t("common.requestFailed")];
  } finally {
    uploading.value = false;
    input.value = "";
  }
}
</script>

<template>
  <div
    class="upload"
    @click="pickFiles"
  >
    <el-icon
      :size="22"
      color="hsl(var(--primary))"
    >
      <UploadFilled />
    </el-icon>
    <p class="upload-title">
      {{ t("page.upload-zone.s15") }}
      <span class="upload-link">{{ t("page.upload-zone.s16") }}</span>
    </p>
    <p class="upload-sub">
      {{ t("page.upload-zone.s17") }}
    </p>
    <input
      ref="fileInput"
      type="file"
      multiple
      hidden
      :data-kb-id="kbId"
      @change="onFilesChosen"
    >
    <span
      v-if="uploading"
      class="hint"
    >{{ t("page.settings.s87") }}…</span>
  </div>
  <div
    v-if="uploadErrors.length > 0"
    class="alert-box"
  >
    <p
      v-for="(err, i) in uploadErrors"
      :key="i"
    >
      {{ err }}
    </p>
  </div>
</template>

<style scoped src="./kb-detail.css"></style>
