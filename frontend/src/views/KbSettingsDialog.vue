<script setup lang="ts">
import { ref } from "vue";
import { useTranslation } from "i18next-vue";
import { ApiError } from "@/api/client";
import { deleteKb, patchKb, type Kb } from "@/api/kb";

const { t } = useTranslation();
const props = defineProps<{ kbId: string; kb: Kb | null }>();
const emit = defineEmits<{ saved: []; deleted: [] }>();

const open = ref(false);
const editName = ref("");
const editDesc = ref("");
const settingsMsg = ref<string | null>(null);

function show() {
  editName.value = props.kb?.name ?? "";
  editDesc.value = props.kb?.desc ?? "";
  settingsMsg.value = null;
  open.value = true;
}

async function save() {
  if (!editName.value.trim()) return;
  try {
    await patchKb(props.kbId, { name: editName.value.trim(), desc: editDesc.value.trim() });
    open.value = false;
    emit("saved");
  } catch (e) {
    settingsMsg.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
  }
}

async function remove() {
  if (!window.confirm(t("page.kb.s8", { name: props.kb?.name ?? "" }))) return;
  try {
    await deleteKb(props.kbId);
    open.value = false;
    emit("deleted");
  } catch {
    /* ignore */
  }
}

defineExpose({ show });
</script>

<template>
  <el-dialog
    v-model="open"
    :title="t('page.app-shell.s16')"
    width="420px"
  >
    <div class="form">
      <label class="field">
        <span class="label">{{ t("page.kb-settings-dialog.s0") }}</span>
        <el-input v-model="editName" />
      </label>
      <label class="field">
        <span class="label">{{ t("page.kb-settings-dialog.s18") }}</span>
        <el-input
          v-model="editDesc"
          type="textarea"
          :rows="2"
        />
      </label>
      <p
        v-if="settingsMsg"
        class="err"
      >
        {{ settingsMsg }}
      </p>
    </div>
    <template #footer>
      <el-button
        type="danger"
        plain
        @click="remove"
      >
        {{ t("page.document-list.s10") }}
      </el-button>
      <el-button @click="open = false">
        {{ t("common.cancel") }}
      </el-button>
      <el-button
        type="primary"
        @click="save"
      >
        {{ t("common.save") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="./kb-detail.css"></style>
