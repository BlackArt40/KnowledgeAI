<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import { EditPen, RefreshRight, Share } from "@element-plus/icons-vue";
import { formatRelative } from "@kai/shared/format";
import type { KbDoc, KbStats } from "@/api/kb";

const { t } = useTranslation();
defineProps<{
  docs: KbDoc[];
  canEdit: boolean;
  hasProcessing: boolean;
  stats: KbStats | null;
  reindexMsg: string | null;
  kbLive: boolean;
}>();
const emit = defineEmits<{
  open: [KbDoc];
  share: [KbDoc];
  reindex: [KbDoc];
  remove: [KbDoc];
}>();

const STATUS_LABEL: Record<string, string> = {
  queued: "page.document-list.s2",
  parsing: "page.document-list.s3",
  chunking: "page.document-list.s4",
  vectorizing: "page.document-list.s5",
  ready: "page.document-list.s6",
  failed: "page.document-list.s7",
};
</script>

<template>
  <!-- 文档表 -->
  <div class="card">
    <div class="card-head">
      <h3>{{ t("page.document-list.s1") }}</h3>
      <span
        v-if="hasProcessing"
        class="hint"
      >↻ {{ t("page.knowledge-base-[id].s37", { count: stats?.processing ?? 0 }) }}…</span>
      <span
        v-else-if="reindexMsg"
        class="hint"
      >{{ reindexMsg }}</span>
      <span
        v-if="kbLive"
        class="hint"
        aria-live="polite"
      >● {{ t("page.knowledge-base-[id].s38") }}</span>
    </div>
    <div class="card-body">
      <div
        v-if="docs.length === 0"
        class="hint"
        style="padding: 24px 0; text-align: center"
      >
        {{ t("page.document-list.s0") }}
      </div>
      <div
        v-for="d in docs"
        :key="d.id"
        class="doc-row"
      >
        <span class="doc-main">
          <span class="doc-name">{{ d.name }}</span>
          <span class="doc-meta">
            {{ d.type }} · {{ t("page.document-list.s15", { count: d.chunks }) }} · v{{ d.version ?? 1 }} · {{ formatRelative(d.uploadedAt) }}
            <span
              v-if="d.error"
              class="err"
            > · {{ d.error }}</span>
          </span>
        </span>
        <span class="doc-right">
          <span
            class="badge"
            :class="d.status === 'ready' ? 'ok' : d.status === 'failed' ? 'err' : 'warn'"
          >
            {{ t(STATUS_LABEL[d.status] ?? d.status) }}
          </span>
          <el-button
            size="small"
            text
            :icon="EditPen"
            @click="emit('open', d)"
          >
            {{ canEdit ? t("page.document-list.s22") : t("page.document-list.s26") }}
          </el-button>
          <el-tooltip
            v-if="canEdit"
            :content="t('page.share-link-dialog.s18')"
            placement="top"
          >
            <el-button
              size="small"
              text
              :icon="Share"
              :aria-label="t('page.share-link-dialog.s18')"
              @click="emit('share', d)"
            />
          </el-tooltip>
          <el-button
            v-if="!['queued', 'parsing', 'chunking', 'vectorizing'].includes(d.status)"
            size="small"
            text
            :icon="RefreshRight"
            @click="emit('reindex', d)"
          >
            {{ t("page.document-list.s19") }}
          </el-button>
          <el-button
            size="small"
            text
            type="danger"
            @click="emit('remove', d)"
          >
            {{ t("page.document-list.s10") }}
          </el-button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped src="./kb-detail.css"></style>
