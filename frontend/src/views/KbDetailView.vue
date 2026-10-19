<script setup lang="ts">
// KB 详情（V3，复刻 knowledge-base/[id]/page.tsx）：统计头 + 上传区
// （multipart files，201=已入队）+ 文档表（状态/轮询/删除）+ KB 设置
// （改名/删库）+ 图谱入口。上传后 3s 轮询刷新直到无 processing 文档。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { UploadFilled } from "@element-plus/icons-vue";
import {
  deleteDoc, deleteKb, fetchKbDetail, patchKb, uploadDocs,
  type Kb, type KbDoc, type KbStats,
} from "@/api/kb";
import { ApiError } from "@/api/client";
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

onMounted(refresh);
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
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
  ready: "page.document-list.s11", queued: "queued", parsing: "parsing", chunking: "chunking", vectorizing: "vectorizing", failed: "page.document-list.s12",
};

const hasProcessing = computed(() =>
  docs.value.some((d) => ["queued", "parsing", "chunking", "vectorizing"].includes(d.status))
);
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
              :style="{ background: kb.color || 'hsl(var(--primary))' }"
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
        <span class="stat-chip ok">{{ stats?.ready ?? 0 }} ready</span>
        <span
          v-if="(stats?.processing ?? 0) > 0"
          class="stat-chip warn"
        >
          {{ stats?.processing }} {{ t("page.knowledge-base-[id].s37", { count: stats?.processing ?? 0 }) }}
        </span>
        <span class="stat-chip">{{ stats?.chunks ?? 0 }} chunks</span>
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
                {{ d.type }} · {{ d.chunks }} chunks · {{ formatRelative(d.uploadedAt) }}
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
                {{ STATUS_LABEL[d.status] ?? d.status }}
              </span>
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
            <span class="label">{{ t("page.knowledge-base.s12") }}</span>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title-row h2 {
  margin: 0;
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
.sub {
  margin: 6px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  height: 32px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
}
.btn.small {
  height: 30px;
}
.btn.outline {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
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
.upload-sub {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
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
.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.badge.ok {
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.badge.err {
  background: hsl(var(--destructive) / 0.12);
  color: hsl(var(--destructive));
}
.badge.warn {
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
}
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
.hint {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
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
.empty {
  display: grid;
  gap: 12px;
  justify-items: center;
  padding: 60px 0;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
}
.sk {
  border-radius: 12px;
  background: hsl(var(--muted));
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
