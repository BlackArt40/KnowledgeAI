<script setup lang="ts">
// KB 详情（V3，复刻 knowledge-base/[id]/page.tsx）：统计头 + 上传区
// （multipart files，201=已入队）+ 文档表（状态/轮询/删除）+ KB 设置
// （改名/删库）+ 图谱入口。上传后 3s 轮询刷新直到无 processing 文档。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { RefreshRight, UploadFilled } from "@element-plus/icons-vue";
import {
  deleteDoc, deleteKb, fetchKbDetail, patchKb, reindexDoc, reindexKb, uploadDocs,
  type Kb, type KbDoc, type KbStats,
} from "@/api/kb";
import { ApiError } from "@/api/client";
import { subscribeEvents } from "@/lib/event-stream";
import { applyKbEvent } from "@/lib/kb-events";
import { kbAvatarBackground } from "@/lib/kb-color";
import { formatRelative } from "@shared/format";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const kbId = String(route.params.id ?? "");
const kb = ref<Kb | null>(null);
const docs = ref<KbDoc[]>([]);
const stats = ref<KbStats | null>(null);
const loading = ref(true);
const notFound = ref(false);
const uploading = ref(false);
const uploadErrors = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const d = await fetchKbDetail(kbId);
    kb.value = d.kb;
    docs.value = d.docs;
    stats.value = d.stats;
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
    const r = await uploadDocs(kbId, files);
    uploadErrors.value = r.errors ?? [];
    await refresh();
  } catch (err) {
    uploadErrors.value = [err instanceof ApiError && err.message ? err.message : t("common.requestFailed")];
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

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

// ── KB 设置（改名/删库）──────────────────────────────────────────────────
const settingsOpen = ref(false);
const editName = ref("");
const editDesc = ref("");
const settingsMsg = ref<string | null>(null);

function openSettings() {
  editName.value = kb.value?.name ?? "";
  editDesc.value = kb.value?.desc ?? "";
  settingsMsg.value = null;
  settingsOpen.value = true;
}

async function saveSettings() {
  if (!editName.value.trim()) return;
  try {
    await patchKb(kbId, { name: editName.value.trim(), desc: editDesc.value.trim() });
    settingsOpen.value = false;
    await refresh();
  } catch (e) {
    settingsMsg.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s40");
  }
}

async function removeKb() {
  if (!window.confirm(t("page.kb.s8", { name: kb.value?.name ?? "" }))) return;
  try {
    await deleteKb(kbId);
    await router.push("/knowledge-base");
  } catch {
    /* ignore */
  }
}

const STATUS_LABEL: Record<string, string> = {
  ready: "page.document-list.s11",
  queued: "page.document-list.s16",
  parsing: "page.document-list.s17",
  chunking: "page.document-list.s18",
  vectorizing: "page.document-list.s13",
  failed: "page.document-list.s12",
};

const hasProcessing = computed(() =>
  docs.value.some((d) => ["queued", "parsing", "chunking", "vectorizing"].includes(d.status))
);

// ── 实时变更（P4-1，/api/knowledge-base/[id]/events）─────────────────────
let kbEvents: { stop: () => void } | null = null;
/** 流已连上才展示「实时同步」提示（断开/重连中不再误导用户） */
const kbLive = ref(false);

function onKbEvent(event: Record<string, unknown>) {
  const type = String(event.type ?? "");
  if (type === "init") return;
  // 事件语义在 lib/kb-events.ts（纯函数，单测覆盖）；这里只做副作用
  const result = applyKbEvent(docs.value, event);
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

      <!-- 上传区 -->
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
                {{ d.type }} · {{ t("page.document-list.s15", { count: d.chunks }) }} · {{ formatRelative(d.uploadedAt) }}
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
                v-if="!['queued', 'parsing', 'chunking', 'vectorizing'].includes(d.status)"
                size="small"
                text
                :icon="RefreshRight"
                @click="reindexOne(d)"
              >
                {{ t("page.document-list.s19") }}
              </el-button>
              <el-button
                size="small"
                text
                type="danger"
                @click="removeDoc(d)"
              >
                {{ t("page.document-list.s10") }}
              </el-button>
            </span>
          </div>
        </div>
      </div>

      <!-- KB 设置对话框 -->
      <el-dialog
        v-model="settingsOpen"
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
            @click="removeKb"
          >
            {{ t("page.document-list.s10") }}
          </el-button>
          <el-button @click="settingsOpen = false">
            {{ t("common.cancel") }}
          </el-button>
          <el-button
            type="primary"
            @click="saveSettings"
          >
            {{ t("common.save") }}
          </el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 64rem;
  margin: 0 auto;
  display: grid;
  gap: 16px;
}
.head {
  display: flex;
  flex-wrap: wrap; /* 长库名 + 操作按钮在窄屏放不下时换行，而不是撑出横向滚动 */
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.head-main {
  min-width: 0;
  flex: 1;
}
.title-row {
  display: flex;
  min-width: 0; /* 长库名在窄屏可换行，不把 head-actions 挤出视口 */
  align-items: center;
  gap: 12px;
}
.title-row h2 {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.kb-avatar {
  display: flex;
  height: 40px;
  width: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}
.sub { margin: 6px 0 0; }

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.btn { padding: 0 12px; height: 32px; font-size: 13px; font-weight: 500; }

.btn.small {
  height: 30px;
}
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stat-chip {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.stat-chip.ok {
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.stat-chip.warn {
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
}
.upload {
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: 28px 16px;
  border: 1.5px dashed hsl(var(--border));
  border-radius: 12px;
  cursor: pointer;
  background: hsl(var(--card));
}
.upload:hover {
  border-color: hsl(var(--primary));
  background: hsl(var(--accent) / 0.3);
}
.upload-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.upload-link {
  margin-left: 4px;
  color: hsl(var(--primary));
}
.upload-sub {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 0;
}
.card-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.card-body {
  padding: 10px 20px 16px;
}
.doc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.doc-row:last-child {
  border-bottom: 0;
}
.doc-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.doc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.doc-meta {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.doc-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.badge { padding: 2px 8px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

.form {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.hint { font-size: 13px; }

.err {
  color: hsl(var(--destructive));
}
.alert-box {
  padding: 10px 14px;
  border: 1px solid hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.05);
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--destructive));
}
.alert-box p {
  margin: 2px 0;
}
.empty { display: grid; gap: 12px; justify-items: center; padding: 60px 0; font-size: 14px; }

</style>
