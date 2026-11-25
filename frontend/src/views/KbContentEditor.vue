<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useTranslation } from "i18next-vue";
import CollabMarkdownEditor from "@/components/kb/CollabMarkdownEditor.vue";
import { ApiError } from "@/api/client";
import { fetchKbDetail, saveDocContent, type KbDoc } from "@/api/kb";
import { renderMarkdown } from "@/lib/markdown";
import { createCollabSession, type CollabSession, type CollabStatus } from "@/lib/collab-session";

const { t } = useTranslation();
const props = defineProps<{ kbId: string; canEdit: boolean }>();
const emit = defineEmits<{ saved: [] }>();

// ── 正文编辑（P3）：乐观并发 + 只读角色禁止保存 ──────────────────────────
const editorOpen = ref(false);
const editorDoc = ref<KbDoc | null>(null);
const editorText = ref("");
const editorLoadedText = ref("");
const editorBase = ref(1);
const editorMode = ref<"edit" | "preview">("edit");
const editorSaving = ref(false);
const editorError = ref<string | null>(null);
const editorRemote = ref<{ editedBy?: string; version?: number } | null>(null);
const editorDirty = computed(() => editorText.value !== editorLoadedText.value);
// Phase 2c: when a Yjs session is active the editor is CodeMirror-bound; the
// textarea/save button stay as the fallback when bootstrap fails.
const collabSession = shallowRef<CollabSession | null>(null);
const collabEnabled = ref(false);
const collabText = ref("");
const collabStatus = ref<CollabStatus | "">("");
let collabTextOff: (() => void) | null = null;
let collabStatusOff: (() => void) | null = null;

const editorPreview = computed(() =>
  renderMarkdown(collabEnabled.value ? collabText.value : editorText.value)
);

function stopCollab() {
  collabTextOff?.();
  collabStatusOff?.();
  collabTextOff = null;
  collabStatusOff = null;
  collabSession.value?.destroy();
  collabSession.value = null;
  collabEnabled.value = false;
  collabStatus.value = "";
  collabText.value = "";
}

async function startCollab(doc: KbDoc) {
  stopCollab();
  try {
    const session = await createCollabSession(props.kbId, doc.id);
    collabSession.value = session;
    collabEnabled.value = true;
    collabStatus.value = "synced";
    collabTextOff = session.onText((value) => { collabText.value = value; });
    collabStatusOff = session.onStatus((status) => { collabStatus.value = status; });
  } catch {
    // Fall back to the Phase 1 textarea + explicit save.
    stopCollab();
  }
}

function open(d: KbDoc) {
  editorDoc.value = d;
  editorText.value = String(d.content ?? "");
  editorLoadedText.value = editorText.value;
  editorBase.value = d.version ?? 1;
  editorMode.value = "edit";
  editorError.value = null;
  editorRemote.value = null;
  editorOpen.value = true;
  void startCollab(d);
}

/** 其他成员保存后：用最新内容覆盖编辑器（仅在用户确认后，避免吞掉未保存输入）。 */
async function reloadEditor() {
  if (!editorDoc.value) return;
  const id = editorDoc.value.id;
  const d = await fetchKbDetail(props.kbId);
  const latest = d.docs.find((x) => x.id === id);
  if (!latest) return;
  editorDoc.value = latest;
  editorText.value = String(latest.content ?? "");
  editorLoadedText.value = editorText.value;
  editorBase.value = latest.version ?? 1;
  editorRemote.value = null;
  editorError.value = null;
}

async function saveEditor() {
  if (!editorDoc.value || !props.canEdit || editorSaving.value) return;
  if (!editorText.value.trim()) {
    editorError.value = t("page.document-list.s28");
    return;
  }
  editorSaving.value = true;
  editorError.value = null;
  try {
    const r = await saveDocContent(props.kbId, editorDoc.value.id, editorText.value, editorBase.value);
    editorDoc.value = r.doc;
    editorText.value = String(r.doc.content ?? editorText.value);
    editorLoadedText.value = editorText.value;
    editorBase.value = r.doc.version ?? editorBase.value + 1;
    editorRemote.value = null;
    emit("saved");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      editorError.value = t("page.document-list.s25");
      editorRemote.value = { version: Number((e.body as { currentVersion?: number })?.currentVersion) || undefined };
    } else {
      editorError.value = e instanceof ApiError && e.message ? e.message : t("common.requestFailed");
    }
  } finally {
    editorSaving.value = false;
  }
}


function applyYjs(docId: string, update: string) {
  if (collabSession.value && editorDoc.value?.id === docId) {
    collabSession.value.applyRemote(update);
  }
}
function notifyRemote(docId: string, editedBy?: string, version?: number) {
  if (!collabEnabled.value && editorOpen.value && editorDoc.value?.id === docId) {
    editorRemote.value = { editedBy, version };
  }
}
defineExpose({ open, applyYjs, notifyRemote });
</script>

<template>
  <!-- 正文编辑（P3）：Markdown 编辑 + 预览，乐观并发 -->
  <el-drawer
    v-model="editorOpen"
    size="60%"
    :title="editorDoc?.name ?? ''"
    @closed="stopCollab"
  >
    <div class="doc-editor">
      <div class="de-head">
        <span class="de-meta">
          <template v-if="collabEnabled">
            {{ collabStatus === "error" ? t("page.document-list.s33") : collabStatus === "syncing" ? t("page.document-list.s32") : t("page.document-list.s31") }}
          </template>
          <template v-else>
            {{ t("page.document-list.s27", { version: editorBase, name: editorDoc?.editedBy || "—" }) }}
          </template>
        </span>
        <el-radio-group
          v-model="editorMode"
          size="small"
        >
          <el-radio-button value="edit">
            {{ t("page.document-list.s23") }}
          </el-radio-button>
          <el-radio-button value="preview">
            {{ t("page.document-list.s24") }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <el-alert
        v-if="editorRemote && !collabEnabled"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #title>
          {{ t("page.document-list.s25") }}
        </template>
        <el-button
          size="small"
          @click="reloadEditor"
        >
          {{ t("page.document-list.s29") }}
        </el-button>
      </el-alert>

      <CollabMarkdownEditor
        v-if="editorMode === 'edit' && collabEnabled && collabSession"
        :text="collabSession.text"
        :read-only="!canEdit"
      />
      <el-input
        v-else-if="editorMode === 'edit'"
        v-model="editorText"
        type="textarea"
        :rows="20"
        :readonly="!canEdit"
      />
      <!-- markdown-it html:false 渲染，无脚本注入面 -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-else
        class="de-preview"
        v-html="editorPreview"
      />
      <!-- eslint-enable vue/no-v-html -->

      <p
        v-if="editorError"
        class="err"
      >
        {{ editorError }}
      </p>
      <div class="de-foot">
        <span
          v-if="collabEnabled"
          class="hint"
        >{{ collabStatus === "error" ? t("page.document-list.s33") : collabStatus === "syncing" ? t("page.document-list.s32") : t("page.document-list.s31") }}</span>
        <span
          v-else-if="editorDirty"
          class="hint"
        >{{ t("page.document-list.s30") }}</span>
        <el-button
          v-if="canEdit && !collabEnabled"
          type="primary"
          :loading="editorSaving"
          :disabled="!editorDirty"
          @click="saveEditor"
        >
          {{ t("common.save") }}
        </el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped src="./kb-detail.css"></style>
