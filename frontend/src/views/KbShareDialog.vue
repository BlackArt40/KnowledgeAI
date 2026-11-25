<script setup lang="ts">
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { ApiError } from "@/api/client";
import ShareLinkDialog from "@/components/kb/ShareLinkDialog.vue";
import {
  createDocShare, createKbShare, fetchDocShare, fetchKbShare,
  revokeDocShare, revokeKbShare,
  type KbDoc, type ShareInput, type ShareLink,
} from "@/api/kb";

type ShareTarget = { kind: "kb" } | { kind: "doc"; doc: KbDoc };

const { t } = useTranslation();
const props = defineProps<{ kbId: string; kbName: string }>();

const target = ref<ShareTarget | null>(null);
const open = ref(false);
const info = ref<ShareLink | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const title = computed(() =>
  target.value?.kind === "doc" ? t("page.share-link-dialog.s18") : t("page.kb-share.s0")
);
const subtitle = computed(() =>
  target.value?.kind === "doc" ? target.value.doc.name : props.kbName
);
const link = computed(() => {
  const tgt = target.value;
  const share = info.value;
  if (!tgt || !share) return "";
  return `${window.location.origin}/${tgt.kind === "kb" ? "share-kb" : "share-doc"}/${share.token}`;
});

function errorText(e: unknown): string {
  return e instanceof ApiError && e.message ? e.message : t("common.requestFailed");
}

async function show(next: ShareTarget) {
  target.value = next;
  info.value = null;
  error.value = null;
  open.value = true;
  loading.value = true;
  try {
    info.value = next.kind === "kb"
      ? await fetchKbShare(props.kbId)
      : await fetchDocShare(props.kbId, next.doc.id);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

async function submit(payload: ShareInput) {
  const tgt = target.value;
  if (!tgt) return;
  saving.value = true;
  error.value = null;
  try {
    info.value = tgt.kind === "kb"
      ? await createKbShare(props.kbId, payload)
      : await createDocShare(props.kbId, tgt.doc.id, payload);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}

async function revoke() {
  const tgt = target.value;
  if (!tgt) return;
  saving.value = true;
  error.value = null;
  try {
    if (tgt.kind === "kb") await revokeKbShare(props.kbId);
    else await revokeDocShare(props.kbId, tgt.doc.id);
    info.value = null;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}

defineExpose({ show });
</script>

<template>
  <ShareLinkDialog
    v-model:open="open"
    :title="title"
    :subtitle="subtitle"
    :share="info"
    :link="link"
    :loading="loading"
    :saving="saving"
    :error="error"
    @create="submit"
    @revoke="revoke"
  />
</template>
