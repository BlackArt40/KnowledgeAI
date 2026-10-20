<script setup lang="ts">
// Agent 调研（V4，复刻 src/app/(app)/agent/page.tsx）：SSE 运行流
// （@shared/sse 单源解析，事件 init/step/done/error/end 冻结）、composer
// （主题/知识库含公开检索哨兵/输出格式/深度/模板/Agent 组合）、时间线 +
// DAG 可视化、报告 markdown+引用（复制/编辑/分享/导出 md|pdf|pptx|mindmap）、
// 版本历史（diff+恢复）与协作评论（P2-3 报告增强）、历史任务侧栏、
// 深链接 ?task=。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import {
  MagicStick,
  EditPen,
  Check,
  Close,
  CopyDocument,
  Share,
  Download,
  Document,
  Delete,
  RefreshRight,
  Plus,
} from "@element-plus/icons-vue";
import { consumeSseStream } from "@shared/sse";
import { formatDateTime } from "@shared/format";
import { streamRequest } from "@/api/client";
import { diffLines, type DiffLine } from "@shared/agent/diff";
import { TEMPLATES, type TemplateId } from "@shared/agent/templates";
import type { AgentStep, AgentTask, DagEdge, DagNode, ExportFormat, OutputFormat, ReportVersion, ShareConfig } from "@shared/agent/types";
import { fetchKbs } from "@/api/kb";
import {
  fetchAgentTasks,
  fetchAgentTask,
  saveAgentReport,
  restoreAgentVersion,
  putAgentShare,
  fetchAgentShare,
  fetchAgentComments,
  postAgentComment,
  deleteAgentComment,
  type AgentComment,
} from "@/api/agent";
import { renderChatMarkdown } from "@/lib/markdown";
import "@/styles/agent-view.css";
import { ROLE_ORDER, inferDagEdges, inferDagNodes, type TFunc } from "@/lib/agent-dag";
import AgentComposer from "@/components/agent/AgentComposer.vue";
import AgentRunPanel from "@/components/agent/AgentRunPanel.vue";
import AgentShareDialog from "@/components/agent/AgentShareDialog.vue";
import AgentSideColumn from "@/components/agent/AgentSideColumn.vue";

// 公开检索哨兵（与 Next 页一致）：选择器空值语义规避，提交时转 undefined
const PUBLIC_SEARCH = "public";

const { t, i18next } = useTranslation();
const route = useRoute();

interface KbLite {
  id: string;
  name: string;
}

const kbs = ref<KbLite[]>([]);
const kbId = ref<string>(PUBLIC_SEARCH);
const topic = ref(t("page.agent.s35"));
const format = ref<OutputFormat>("report");
const depth = ref(5);
const template = ref<TemplateId>("default");
const enabledAgents = ref<string[]>(["planner", "searcher", "analyzer", "writer"]);

const running = ref(false);
const steps = ref<AgentStep[]>([]);
const task = ref<AgentTask | null>(null);
const history = ref<AgentTask[]>([]);
const highlightN = ref<number | null>(null);
const copied = ref<string | null>(null);
const runError = ref<string | null>(null);
const abortRef = ref<AbortController | null>(null);

const activeTab = ref("report");
const editing = ref(false);
const editText = ref("");
const saving = ref(false);
const shareOpen = ref(false);

const reportHtml = computed(() => (task.value?.report ? renderChatMarkdown(task.value.report) : ""));

async function refreshHistory() {
  try {
    history.value = await fetchAgentTasks();
    // 深链接 ?task=：历史就绪后打开目标任务
    if (pendingTask.value) {
      const id = pendingTask.value;
      pendingTask.value = null;
      if (history.value.some((x) => x.id === id)) void loadTask(id);
    }
  } catch {
    /* keep previous list */
  }
}

const pendingTask = ref<string | null>(null);

async function loadTask(id: string) {
  try {
    const taskData = await fetchAgentTask(id);
    if (taskData) {
      task.value = taskData;
      steps.value = taskData.steps ?? [];
      highlightN.value = null;
      activeTab.value = "report";
      editing.value = false;
    }
  } catch {
    /* 404/无权：静默保持当前视图 */
  }
}

onMounted(() => {
  const taskParam = typeof route.query.task === "string" ? route.query.task : "";
  if (taskParam) pendingTask.value = taskParam;
  void fetchKbs()
    .then((list) => (kbs.value = list.map((k) => ({ id: k.id, name: k.name }))))
    .catch(() => {});
  void refreshHistory();
});

// ── 运行（SSE）───────────────────────────────────────────────────────────
async function run() {
  if (!topic.value.trim() || running.value) return;
  running.value = true;
  task.value = null;
  steps.value = [];
  highlightN.value = null;
  runError.value = null;
  // 一次运行必须以 done / error 事件之一收尾；流中途断开也要给出提示
  let settled = false;
  const controller = new AbortController();
  abortRef.value = controller;
  try {
    const res = await streamRequest(
      "/api/agent/run",
      {
        topic: topic.value.trim(),
        kbId: kbId.value === PUBLIC_SEARCH ? undefined : kbId.value,
        outputFormat: format.value,
        maxSteps: depth.value,
        template: template.value,
        agents: enabledAgents.value,
      },
      controller.signal
    );
    if (!res.ok || !res.body) {
      // 限流/配额/鉴权拒绝在 SSE 流之前以 JSON 返回——优先展示服务端原因
      const denied = (await res.json().catch(() => null)) as { error?: string } | null;
      runError.value = denied?.error || t("common.requestFailed");
      return;
    }
    await consumeSseStream(res, (data) => {
      const d = data as { type: string; step?: AgentStep; task?: AgentTask; code?: string; message?: string };
      if (d.type === "step" && d.step) {
        const i = steps.value.findIndex((s) => s.role === d.step!.role);
        if (i >= 0) steps.value[i] = d.step;
        else steps.value.push(d.step);
      } else if (d.type === "done" && d.task) {
        settled = true;
        task.value = d.task;
        steps.value = d.task.steps ?? [];
        void refreshHistory();
      } else if (d.type === "error") {
        settled = true;
        // 已知失败带稳定 code（按 UI 语言本地化），未知错误原样展示
        runError.value =
          d.code === "queue_busy" ? t("page.agent.s86")
          : d.code === "queue_failed" ? t("page.agent.s87")
          : d.message || t("page.agent.s88");
        void refreshHistory();
      }
    });
    if (!settled) runError.value = t("page.agent.s88");
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    runError.value = aborted ? null : t("common.networkError");
  } finally {
    abortRef.value = null;
    running.value = false;
  }
}

function stopRun() {
  abortRef.value?.abort();
  abortRef.value = null;
  running.value = false;
}

onBeforeUnmount(() => {
  abortRef.value?.abort();
  abortRef.value = null;
});

function pickTemplate(id: TemplateId) {
  template.value = id;
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (tpl) {
    format.value = tpl.defaultFormat;
    enabledAgents.value = [...tpl.agents];
  }
}

function toggleAgent(role: string) {
  enabledAgents.value = enabledAgents.value.includes(role)
    ? enabledAgents.value.filter((r) => r !== role)
    : [...enabledAgents.value, role];
}

function copyText(text: string, key: string) {
  void navigator.clipboard?.writeText(text);
  copied.value = key;
  setTimeout(() => (copied.value = null), 1500);
}

// ── 导出 / 编辑 ─────────────────────────────────────────────────────────
function exportItems(t2: TFunc): { value: ExportFormat; label: string }[] {
  return [
    { value: "md", label: "Markdown (.md)" },
    { value: "pdf", label: t2("page.agent.s32") },
    { value: "pptx", label: t2("page.agent.s33") },
    { value: "mindmap", label: t2("page.agent.s34") },
  ];
}

function doExport(fmt: ExportFormat) {
  if (!task.value) return;
  const url = `/api/agent/tasks/${task.value.id}/export?format=${fmt}`;
  if (fmt === "pdf") {
    window.open(url, "_blank");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function startEdit() {
  if (!task.value?.report) return;
  editText.value = task.value.report;
  editing.value = true;
}

async function saveEdit() {
  if (!task.value) return;
  saving.value = true;
  try {
    const d = await saveAgentReport(task.value.id, editText.value);
    if (d.task) {
      task.value = d.task;
      editing.value = false;
      void refreshHistory();
    }
  } finally {
    saving.value = false;
  }
}

function onReportClick(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest("[data-cite]");
  if (el) highlightN.value = Number((el as HTMLElement).dataset.cite);
}

// ── DAG 可视化（task.dagNodes 未就绪时按 steps/模板推导）────────────────
const dagNodes = computed<DagNode[]>(() => {
  if (task.value?.dagNodes?.length) return task.value.dagNodes;
  return inferDagNodes(steps.value, enabledAgents.value, t);
});
const dagEdges = computed<DagEdge[]>(() => task.value?.dagEdges ?? inferDagEdges(template.value));

const sortedSteps = computed(() =>
  [...steps.value].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
);

const showTimeline = computed(() => running.value || steps.value.length > 0);

// ── 版本历史（diff + 恢复）──────────────────────────────────────────────
const versions = computed<ReportVersion[]>(() => task.value?.versions ?? []);
const diffVid = ref<string | null>(null);
const diffLinesState = ref<DiffLine[]>([]);
const restoreBusy = ref(false);
const diffSelected = computed(() => versions.value.find((v) => v.id === diffVid.value) ?? null);

function showDiff(v: ReportVersion) {
  diffVid.value = v.id;
  diffLinesState.value = diffLines(v.content, task.value?.report ?? "");
}

async function restore(v: ReportVersion) {
  if (!task.value || !window.confirm(t("page.agent.s55", { label: v.label }))) return;
  restoreBusy.value = true;
  try {
    await restoreAgentVersion(task.value.id, v.id);
    await loadTask(task.value.id);
    diffVid.value = null;
  } finally {
    restoreBusy.value = false;
  }
}

const addedCount = computed(() => diffLinesState.value.filter((d) => d.op === "add").length);
const removedCount = computed(() => diffLinesState.value.filter((d) => d.op === "remove").length);

// ── 协作评论 ────────────────────────────────────────────────────────────
const comments = ref<AgentComment[]>([]);
const commentText = ref("");
const commentCite = ref("general");
const replyTo = ref<string | null>(null);
const replyText = ref("");

async function loadComments() {
  if (!task.value) return;
  try {
    comments.value = await fetchAgentComments(task.value.id);
  } catch {
    comments.value = [];
  }
}

async function submitComment() {
  if (!task.value || !commentText.value.trim()) return;
  const body: { text: string; citeN?: number } = { text: commentText.value.trim() };
  if (commentCite.value !== "general") body.citeN = Number(commentCite.value);
  await postAgentComment(task.value.id, body).catch(() => {});
  commentText.value = "";
  void loadComments();
}

async function submitReply(parentId: string) {
  if (!task.value || !replyText.value.trim()) return;
  await postAgentComment(task.value.id, { text: replyText.value.trim(), parentId }).catch(() => {});
  replyText.value = "";
  replyTo.value = null;
  void loadComments();
}

async function removeComment(id: string) {
  if (!task.value) return;
  await deleteAgentComment(task.value.id, id).catch(() => {});
  void loadComments();
}

const generalComments = computed(() => comments.value.filter((c) => c.citeN === undefined && !c.parentId));
const citeGroups = computed(() => {
  const map = new Map<number, AgentComment[]>();
  for (const c of comments.value) {
    if (c.citeN !== undefined && !c.parentId) {
      const arr = map.get(c.citeN) ?? [];
      arr.push(c);
      map.set(c.citeN, arr);
    }
  }
  return Array.from(map.entries());
});
const childrenOf = (pid: string) => comments.value.filter((c) => c.parentId === pid);

function onTabChange(name: string | number) {
  activeTab.value = String(name);
  if (activeTab.value === "comments") void loadComments();
}

// ── 分享设置 ────────────────────────────────────────────────────────────
const shareCfg = ref<ShareConfig | null>(null);
const shareEnabled = ref(false);
const shareDays = ref("");
const sharePassword = ref("");
const shareMaxViews = ref("");
const shareSaving = ref(false);

async function openShare() {
  shareOpen.value = true;
  if (!task.value) return;
  try {
    const d = await fetchAgentShare(task.value.id);
    shareCfg.value = d?.shareConfig ?? null;
    shareEnabled.value = !!shareCfg.value?.enabled;
    shareDays.value = shareCfg.value?.expiresAt
      ? String(Math.max(1, Math.ceil((shareCfg.value.expiresAt - Date.now()) / 86400000)))
      : "";
    shareMaxViews.value = shareCfg.value?.maxViews ? String(shareCfg.value.maxViews) : "";
  } catch {
    /* keep current */
  }
}

async function saveShare() {
  if (!task.value) return;
  shareSaving.value = true;
  const body: { enabled: boolean; expiresAt: number | null; password: string | null; maxViews: number | null } = {
    enabled: shareEnabled.value,
    expiresAt: shareDays.value ? Date.now() + Number(shareDays.value) * 86400000 : null,
    password: sharePassword.value || null,
    maxViews: shareMaxViews.value ? Number(shareMaxViews.value) : null,
  };
  try {
    const d = await putAgentShare(task.value.id, body);
    shareCfg.value = d.shareConfig ?? null;
    sharePassword.value = "";
    shareEnabled.value = !!shareCfg.value?.enabled;
  } finally {
    shareSaving.value = false;
  }
}

const shareUrl = computed(() =>
  task.value ? `${window.location.origin}/r/${task.value.id}` : ""
);

const durationText = computed(() => {
  if (!task.value?.durationMs) return "";
  const fmt = task.value.outputFormat === "ppt" ? t("page.agent.s59") : task.value.outputFormat === "mindmap" ? t("page.agent.s60") : t("page.agent.s61");
  return `${t("page.agent.s58", { s: (task.value.durationMs / 1000).toFixed(1) })} · ${fmt}`;
});
</script>

<template>
  <div class="agent-page">
    <div class="page-head">
      <h2>
        <el-icon
          :size="18"
          class="head-ico"
        >
          <MagicStick />
        </el-icon>
        {{ t("page.agent.s62") }}
      </h2>
      <p class="sub">
        {{ t("page.agent.s63") }}
      </p>
    </div>

    <!-- composer -->
    <AgentComposer
      :topic="topic"
      :kb-id="kbId"
      :kbs="kbs"
      :format="format"
      :depth="depth"
      :template="template"
      :enabled-agents="enabledAgents"
      :running="running"
      @update:topic="topic = $event"
      @update:kb-id="kbId = $event"
      @update:format="format = $event"
      @update:depth="depth = $event"
      @pick-template="pickTemplate"
      @toggle-agent="toggleAgent"
      @run="run"
      @stop="stopRun"
    />

    <div class="grid">
      <!-- 主列：错误 / 时间线 / 报告 -->
      <div class="main-col">
        <AgentRunPanel
          :show="showTimeline"
          :run-error="runError"
          :running="running"
          :parallel-executed="!!task?.parallelExecuted"
          :branch-triggered="!!task?.branchTriggered"
          :steps="sortedSteps"
          :dag-nodes="dagNodes"
          :dag-edges="dagEdges"
        />

        <div
          v-if="task?.report"
          class="card"
        >
          <div class="report-head">
            <h3 class="card-title">
              <el-icon
                :size="14"
                class="title-ico"
              >
                <Document />
              </el-icon>
              {{ t("page.agent.s69") }}
            </h3>
            <div class="report-actions">
              <template v-if="editing">
                <el-button
                  size="small"
                  :icon="Close"
                  @click="editing = false"
                >
                  {{ t("common.cancel") }}
                </el-button>
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving"
                  @click="saveEdit"
                >
                  {{ t("common.save") }}
                </el-button>
              </template>
              <template v-else>
                <el-button
                  size="small"
                  @click="copyText(task.report, 'report')"
                >
                  <el-icon
                    v-if="copied === 'report'"
                  >
                    <Check />
                  </el-icon>
                  <el-icon
                    v-else
                  >
                    <CopyDocument />
                  </el-icon>
                  {{ t("common.copy") }}
                </el-button>
                <el-button
                  size="small"
                  :icon="EditPen"
                  @click="startEdit"
                >
                  {{ t("common.edit") }}
                </el-button>
                <el-button
                  size="small"
                  :icon="Share"
                  @click="openShare"
                >
                  {{ t("page.agent.s70") }}
                </el-button>
                <el-dropdown @command="doExport">
                  <el-button
                    type="primary"
                    size="small"
                    :icon="Download"
                  >
                    {{ t("page.agent.s0") }}
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="it in exportItems(t)"
                        :key="it.value"
                        :command="it.value"
                      >
                        {{ it.label }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </div>
          </div>

          <el-tabs
            v-if="!editing && versions.length > 0"
            class="report-tabs"
            :model-value="activeTab"
            @tab-change="onTabChange"
          >
            <el-tab-pane
              :label="t('page.agent.s1')"
              name="report"
            />
            <el-tab-pane
              :label="`${t('page.agent.s71')} (${versions.length})`"
              name="versions"
            />
            <el-tab-pane
              :label="`${t('page.agent.s72')} (${task.comments?.length ?? 0})`"
              name="comments"
            />
          </el-tabs>

          <textarea
            v-if="editing"
            v-model="editText"
            rows="24"
            class="edit-area"
          />
          <template v-else-if="activeTab === 'versions'">
            <div class="versions">
              <div
                v-for="v in versions"
                :key="v.id"
                class="version"
                :class="{ active: diffVid === v.id }"
              >
                <el-icon
                  :size="13"
                  class="v-ico"
                >
                  <Document />
                </el-icon>
                <div class="v-main">
                  <div class="v-label">
                    {{ v.label }}
                  </div>
                  <div class="v-time">
                    {{ formatDateTime(v.createdAt, i18next.language) }}{{ v.author ? ` · ${v.author}` : "" }}
                  </div>
                </div>
                <el-button
                  size="small"
                  text
                  @click="showDiff(v)"
                >
                  {{ t("page.agent.s76") }}
                </el-button>
                <el-button
                  size="small"
                  text
                  :icon="RefreshRight"
                  :disabled="restoreBusy"
                  @click="restore(v)"
                >
                  {{ t("page.agent.s77") }}
                </el-button>
              </div>
              <p
                v-if="versions.length === 0"
                class="empty-hint"
              >
                {{ t("page.agent.s13") }}
              </p>
            </div>
            <div v-if="diffSelected">
              <div class="diff-head">
                <span class="diff-title">{{ t("page.agent.s78", { label: diffSelected.label }) }}</span>
                <el-button
                  size="small"
                  text
                  :icon="Close"
                  @click="diffVid = null"
                >
                  {{ t("common.close") }}
                </el-button>
              </div>
              <p
                v-if="diffLinesState.every((d) => d.op === 'equal')"
                class="empty-hint"
              >
                {{ t("page.agent.s14") }}
              </p>
              <template v-else>
                <div class="diff-stat">
                  <span class="add">+{{ addedCount }} {{ t("page.agent.s79") }}</span>
                  <span class="del">-{{ removedCount }} {{ t("page.agent.s80") }}</span>
                </div>
                <div class="diff-view">
                  <div
                    v-for="(d, i) in diffLinesState"
                    :key="i"
                    class="diff-line"
                    :class="d.op"
                  >
                    <span class="diff-op">{{ d.op === "add" ? "+" : d.op === "remove" ? "-" : " " }}</span>{{ d.text || " " }}
                  </div>
                </div>
              </template>
            </div>
          </template>
          <div
            v-else-if="activeTab === 'comments'"
            class="comments"
          >
            <div class="comment-new">
              <div class="cn-head">
                <el-icon
                  :size="13"
                  class="cn-ico"
                >
                  <Plus />
                </el-icon>
                <span class="cn-title">{{ t("page.agent.s16") }}</span>
                <el-select
                  v-model="commentCite"
                  size="small"
                  class="cn-select"
                >
                  <el-option
                    value="general"
                    :label="t('page.agent.s17')"
                  />
                  <el-option
                    v-for="c in task.citations"
                    :key="c.n"
                    :value="String(c.n)"
                    :label="t('page.agent.s82', { n: c.n })"
                  />
                </el-select>
              </div>
              <textarea
                v-model="commentText"
                rows="2"
                class="cn-input"
                :placeholder="t('page.agent.s47')"
              />
              <div class="cn-foot">
                <el-button
                  size="small"
                  type="primary"
                  :disabled="!commentText.trim()"
                  @click="submitComment"
                >
                  {{ t("page.agent.s18") }}
                </el-button>
              </div>
            </div>
            <p
              v-if="comments.length === 0"
              class="empty-hint"
            >
              {{ t("page.agent.s19") }}
            </p>
            <template v-else>
              <div
                v-for="c in generalComments"
                :key="c.id"
              >
                <div class="comment">
                  <div class="c-head">
                    <span class="c-ava">{{ (c.userName || "?").charAt(0).toUpperCase() }}</span>
                    <span class="c-name">{{ c.userName }}</span>
                    <span class="c-time">{{ formatDateTime(c.createdAt, i18next.language) }}</span>
                    <el-button
                      size="small"
                      text
                      :icon="Delete"
                      class="c-del"
                      :title="t('page.agent.s45')"
                      @click="removeComment(c.id)"
                    />
                  </div>
                  <p class="c-text">
                    {{ c.text }}
                  </p>
                  <button
                    type="button"
                    class="c-reply"
                    @click="replyTo = replyTo === c.id ? null : c.id"
                  >
                    {{ t("page.agent.s81") }}
                  </button>
                  <div
                    v-if="replyTo === c.id"
                    class="c-reply-box"
                  >
                    <input
                      v-model="replyText"
                      class="c-reply-input"
                      :placeholder="t('page.agent.s46')"
                    >
                    <el-button
                      size="small"
                      @click="submitReply(c.id)"
                    >
                      {{ t("page.agent.s15") }}
                    </el-button>
                  </div>
                  <div
                    v-if="childrenOf(c.id).length > 0"
                    class="c-children"
                  >
                    <div
                      v-for="ch in childrenOf(c.id)"
                      :key="ch.id"
                      class="comment reply"
                    >
                      <div class="c-head">
                        <span class="c-ava">{{ (ch.userName || "?").charAt(0).toUpperCase() }}</span>
                        <span class="c-name">{{ ch.userName }}</span>
                        <span class="c-time">{{ formatDateTime(ch.createdAt, i18next.language) }}</span>
                        <el-button
                          size="small"
                          text
                          :icon="Delete"
                          class="c-del"
                          :title="t('page.agent.s45')"
                          @click="removeComment(ch.id)"
                        />
                      </div>
                      <p class="c-text">
                        {{ ch.text }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-for="[n, list] in citeGroups"
                :key="n"
              >
                <div class="c-group">
                  <span class="n-badge">{{ n }}</span>
                  {{ t("page.agent.s83", { n }) }}
                </div>
                <div
                  v-for="c in list"
                  :key="c.id"
                  class="comment"
                >
                  <div class="c-head">
                    <span class="c-ava">{{ (c.userName || "?").charAt(0).toUpperCase() }}</span>
                    <span class="c-name">{{ c.userName }}</span>
                    <span class="c-time">{{ formatDateTime(c.createdAt, i18next.language) }}</span>
                    <el-button
                      size="small"
                      text
                      :icon="Delete"
                      class="c-del"
                      :title="t('page.agent.s45')"
                      @click="removeComment(c.id)"
                    />
                  </div>
                  <p class="c-text">
                    {{ c.text }}
                  </p>
                </div>
              </div>
            </template>
          </div>
          <!-- 报告正文（markdown + [n] 引用 chip） -->
          <div
            v-else
            class="report md"
            @click="onReportClick"
            v-html="reportHtml"
          />
        </div>

        <div
          v-else-if="!showTimeline"
          class="card idle"
        >
          <span class="idle-ava">
            <el-icon :size="22">
              <MagicStick />
            </el-icon>
          </span>
          <p class="idle-title">
            {{ t("page.agent.s7") }}
          </p>
          <p class="idle-sub">
            {{ t("page.agent.s8") }}
          </p>
        </div>
      </div>

      <!-- 侧列：历史 + 引用 -->
      <div class="side-col">
        <AgentSideColumn
          :history="history"
          :active-task-id="task?.id ?? null"
          :citations="task?.citations ?? []"
          :highlight-n="highlightN"
          :duration-text="durationText"
          @select="loadTask"
        />
      </div>
    </div>

    <AgentShareDialog
      v-model:open="shareOpen"
      :share-url="shareUrl"
      :share-cfg="shareCfg"
      :copied="copied === 'share'"
      :share-enabled="shareEnabled"
      :share-days="shareDays"
      :share-password="sharePassword"
      :share-max-views="shareMaxViews"
      :share-saving="shareSaving"
      @update:share-enabled="shareEnabled = $event"
      @update:share-days="shareDays = $event"
      @update:share-password="sharePassword = $event"
      @update:share-max-views="shareMaxViews = $event"
      @copy="copyText(shareUrl, 'share')"
      @save="saveShare"
    />
  </div>
</template>
