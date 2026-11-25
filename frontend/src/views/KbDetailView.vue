<script setup lang="ts">
// KB 详情（V3，复刻 knowledge-base/[id]/page.tsx）：统计头 + 上传区
// （multipart files，201=已入队）+ 文档表（状态/轮询/删除）+ KB 设置
// （改名/删库）+ 图谱入口。上传后 3s 轮询刷新直到无 processing 文档。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { RefreshRight, Share } from "@element-plus/icons-vue";
import {
  deleteDoc, fetchKbDetail,
  reindexDoc, reindexKb,
  type Kb, type KbDoc, type KbStats,
} from "@/api/kb";
import KbContentEditor from "@/views/KbContentEditor.vue";
import KbDocumentTable from "@/views/KbDocumentTable.vue";
import KbUploadPanel from "@/views/KbUploadPanel.vue";
import { ApiError } from "@/api/client";
import KbSettingsDialog from "@/views/KbSettingsDialog.vue";
import KbShareDialog from "@/views/KbShareDialog.vue";
import { subscribeEvents } from "@/lib/event-stream";
import { applyKbEvent, type LiveKbViewer } from "@/lib/kb-events";
import { kbAvatarBackground } from "@/lib/kb-color";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const editorRef = ref<{
  open: (d: KbDoc) => void;
  applyYjs: (docId: string, update: string) => void;
  notifyRemote: (docId: string, editedBy?: string, version?: number) => void;
} | null>(null);

const kbId = String(route.params.id ?? "");
const kb = ref<Kb | null>(null);
const docs = ref<KbDoc[]>([]);
const stats = ref<KbStats | null>(null);
/** 共享与分发：无编辑权限（只读共享/private 库成员）不展示分享入口 */
const canEdit = ref(true);
const loading = ref(true);
const notFound = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const d = await fetchKbDetail(kbId);
    kb.value = d.kb;
    docs.value = d.docs;
    stats.value = d.stats;
    canEdit.value = d.permissions?.canEdit ?? true;
    notFound.value = false;
    schedulePoll();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound.value = true;
  } finally {
    loading.value = false;
  }
}

// 有处理中文档时 3s 轮询，全部终态后停止
function schedulePoll() {
  const hasProcessing = docs.value.some((d) =>
    ["queued", "parsing", "chunking", "vectorizing"].includes(d.status)
  );
  if (hasProcessing && !pollTimer) {
    pollTimer = setInterval(async () => {
      const still = docs.value.some((d) =>
        ["queued", "parsing", "chunking", "vectorizing"].includes(d.status)
      );
      if (!still && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      try {
        const d = await fetchKbDetail(kbId);
        docs.value = d.docs;
        stats.value = d.stats;
      } catch {
        /* ignore */
      }
    }, 3000);
  }
}

onMounted(() => {
  void refresh();
  // P4-1：KB 变更流——成员上传/删除文档、处理进度、设置变更、删库都实时推送。
  // 轮询（schedulePoll）保留为兜底：SSE 断开时页面仍然能推进。
  kbEvents = subscribeEvents(`/api/knowledge-base/${encodeURIComponent(kbId)}/events`, {
    onEvent: onKbEvent,
    onOpen: () => {
      kbLive.value = true;
    },
    onError: () => {
      kbLive.value = false;
    },
    reconnectMs: 5000,
  });
});
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  kbEvents?.stop();
  kbEvents = null;
});

async function removeDoc(doc: KbDoc) {
  if (!window.confirm(t("page.kb.s8", { name: doc.name }) )) return;
  try {
    await deleteDoc(kbId, doc.id);
    await refresh();
  } catch {
    /* ignore */
  }
}

// ── 重建索引（正文已在库里，只重跑切片 + 嵌入）─────────────────────────
const reindexing = ref(false);
const reindexMsg = ref<string | null>(null);

async function reindexOne(doc: KbDoc) {
  reindexMsg.value = null;
  try {
    await reindexDoc(kbId, doc.id);
    reindexMsg.value = t("page.document-list.s20");
    await refresh();
  } catch (e) {
    reindexMsg.value = e instanceof ApiError && e.message ? e.message : t("page.document-list.s21");
  }
}

async function reindexAll() {
  reindexing.value = true;
  reindexMsg.value = null;
  try {
    const r = await reindexKb(kbId);
    reindexMsg.value = t("page.document-list.s20");
    if (r.queued === 0) reindexMsg.value = null;
    await refresh();
  } catch (e) {
    reindexMsg.value = e instanceof ApiError && e.message ? e.message : t("page.document-list.s21");
  } finally {
    reindexing.value = false;
  }
}

// ── 共享与分发：库级 / 文档级公开链接 ────────────────────────────────────
type ShareTarget = { kind: "kb" } | { kind: "doc"; doc: KbDoc };

const shareRef = ref<{ show: (target: ShareTarget) => void } | null>(null);

function openShare(target: ShareTarget) {
  shareRef.value?.show(target);
}

const settingsRef = ref<{ show: () => void } | null>(null);

function openSettings() {
  settingsRef.value?.show();
}


const hasProcessing = computed(() =>
  docs.value.some((d) => ["queued", "parsing", "chunking", "vectorizing"].includes(d.status))
);

// ── 实时变更（P4-1，/api/knowledge-base/[id]/events）─────────────────────
let kbEvents: { stop: () => void } | null = null;
/** 流已连上才展示「实时同步」提示（断开/重连中不再误导用户） */
const kbLive = ref(false);
/** 正在查看该库的其他成员（init 快照 + viewers 变更帧） */
const viewers = ref<LiveKbViewer[]>([]);
const viewerAvatars = computed(() => viewers.value.slice(0, 3));
const viewerNames = computed(() => viewers.value.map((v) => v.name).join(", "));

function openDoc(d: KbDoc) {
  editorRef.value?.open(d);
}

function onKbEvent(event: Record<string, unknown>) {
  const type = String(event.type ?? "");
  // Phase 2c: Yjs 增量直接进入当前会话，不参与列表归约
  if (type === "doc_yjs") {
    editorRef.value?.applyYjs(String(event.docId ?? ""), String(event.update ?? ""));
    return;
  }
  // 事件语义在 lib/kb-events.ts（纯函数，单测覆盖）；这里只做副作用
  const result = applyKbEvent(docs.value, event);
  if (result.viewers) viewers.value = result.viewers;
  if (result.deleted) {
    // 其他成员删掉了当前知识库：断开流并回列表（refresh 会拿到 404）
    kbEvents?.stop();
    kbEvents = null;
    void router.replace("/knowledge-base");
    return;
  }
  if (result.docs !== docs.value) docs.value = result.docs;
  if (type === "docs") schedulePoll();
  if (result.refresh) void refresh();
  // 其他成员保存了正文：不自动覆盖，提示用户重新加载（协同会话已实时同步）
  if (result.docUpdated) {
    editorRef.value?.notifyRemote(
      result.docUpdated.docId,
      result.docUpdated.editedBy,
      result.docUpdated.version
    );
  }
}
</script>

<template>
  <div class="wrap">
    <div
      v-if="loading"
      class="sk"
      style="height: 260px"
    />
    <div
      v-else-if="notFound"
      class="empty"
    >
      <p>{{ t("page.knowledge-base-[id].s1") }}</p>
      <router-link
        to="/knowledge-base"
        class="btn outline small"
      >
        {{ t("page.knowledge-base-[id].s31") }}
      </router-link>
    </div>

    <template v-else-if="kb">
      <div class="head">
        <div class="head-main">
          <div class="title-row">
            <span
              class="kb-avatar"
              :style="{ background: kbAvatarBackground(kb.color, kb.name) }"
            >
              {{ kb.initial || kb.name.charAt(0) }}
            </span>
            <h2>{{ kb.name }}</h2>
            <el-tooltip
              v-if="viewers.length"
              :content="viewerNames"
              placement="bottom"
            >
              <span
                class="viewer-stack"
                :aria-label="t('page.knowledge-base-[id].s39', { count: viewers.length })"
              >
                <span
                  v-for="v in viewerAvatars"
                  :key="v.userId"
                  class="viewer-avatar"
                >{{ v.name.charAt(0) }}</span>
                <span
                  v-if="viewers.length > 3"
                  class="viewer-more"
                >+{{ viewers.length - 3 }}</span>
              </span>
            </el-tooltip>
            <el-button
              size="small"
              text
              @click="openSettings"
            >
              {{ t("page.kb-settings-dialog.s13") }}
            </el-button>
          </div>
          <p
            v-if="kb.desc"
            class="sub"
          >
            {{ kb.desc }}
          </p>
        </div>
        <div class="head-actions">
          <el-button
            v-if="canEdit"
            size="small"
            text
            :icon="Share"
            @click="openShare({ kind: 'kb' })"
          >
            {{ t("page.kb-share.s1") }}
          </el-button>
          <el-button
            size="small"
            text
            :icon="RefreshRight"
            :loading="reindexing"
            :disabled="!docs.length"
            @click="reindexAll"
          >
            {{ t("page.document-list.s19") }}
          </el-button>
          <router-link
            :to="`/knowledge-base/${kbId}/graph`"
            class="btn outline small"
          >
            {{ t("page.knowledge-graph.s1") }}
          </router-link>
        </div>
      </div>

      <div class="stat-row">
        <span class="stat-chip">{{ stats?.total ?? 0 }} {{ t("page.document-list.s1") }}</span>
        <span class="stat-chip ok">{{ stats?.ready ?? 0 }} {{ t("page.document-list.s11") }}</span>
        <span
          v-if="(stats?.processing ?? 0) > 0"
          class="stat-chip warn"
        >
          {{ stats?.processing }} {{ t("page.knowledge-base-[id].s37", { count: stats?.processing ?? 0 }) }}
        </span>
        <span class="stat-chip">{{ t("page.document-list.s15", { count: stats?.chunks ?? 0 }) }}</span>
      </div>

      <KbUploadPanel
        :kb-id="kbId"
        @uploaded="refresh"
      />

      <KbDocumentTable
        :docs="docs"
        :can-edit="canEdit"
        :has-processing="hasProcessing"
        :stats="stats"
        :reindex-msg="reindexMsg"
        :kb-live="kbLive"
        @open="openDoc"
        @share="(d) => openShare({ kind: 'doc', doc: d })"
        @reindex="reindexOne"
        @remove="removeDoc"
      />
      <KbSettingsDialog
        ref="settingsRef"
        :kb-id="kbId"
        :kb="kb"
        @saved="refresh"
        @deleted="router.push('/knowledge-base')"
      />

      <KbShareDialog
        ref="shareRef"
        :kb-id="kbId"
        :kb-name="kb?.name ?? ''"
      />

      <KbContentEditor
        ref="editorRef"
        :kb-id="kbId"
        :can-edit="canEdit"
        @saved="refresh"
      />
    </template>
  </div>
</template>

<style scoped src="./kb-detail.css"></style>
