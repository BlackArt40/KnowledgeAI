<script setup lang="ts">
// Agent 调研（V4，复刻 src/app/(app)/agent/page.tsx）：SSE 运行流
// （@shared/sse 单源解析，事件 init/step/done/error/end 冻结）、composer
// （主题/知识库含公开检索哨兵/输出格式/深度/模板/Agent 组合）、时间线 +
// DAG 可视化、报告 markdown+引用（复制/编辑/分享/导出 md|pdf|pptx|mindmap）、
// 版本历史（diff+恢复）与协作评论（P2-3 报告增强）、历史任务侧栏、
// 深链接 ?task=。
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import {
  MagicStick,
  VideoPlay,
  Loading,
  List,
  Search,
  DataAnalysis,
  EditPen,
  Check,
  Close,
  CopyDocument,
  Share,
  Download,
  Document,
  Clock,
  ArrowRight,
  Delete,
  WarningFilled,
  RefreshRight,
  Plus,
} from "@element-plus/icons-vue";
import { consumeSseStream } from "@shared/sse";
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
  fetchAgentComments,
  postAgentComment,
  deleteAgentComment,
  type AgentComment,
} from "@/api/agent";
import { renderChatMarkdown } from "@/lib/markdown";

type TFunc = (k: string) => string;

const ROLE_ICON: Record<string, object> = {
  planner: List,
  searcher: Search,
  analyzer: DataAnalysis,
  writer: EditPen,
};
const ROLE_ORDER = ["planner", "searcher", "analyzer", "writer"];

function roleLabel(t: TFunc, role: string): string {
  return role === "planner" ? t("page.agent.s40")
    : role === "searcher" ? t("page.agent.s41")
    : role === "analyzer" ? t("page.agent.s42")
    : t("page.agent.s43");
}

function formatOpts(t: TFunc): { value: OutputFormat; label: string }[] {
  return [
    { value: "report", label: t("page.agent.s29") },
    { value: "ppt", label: t("page.agent.s30") },
    { value: "mindmap", label: t("page.agent.s31") },
  ];
}

// 公开检索哨兵（与 Next 页一致）：选择器空值语义规避，提交时转 undefined
const PUBLIC_SEARCH = "public";

const { t } = useTranslation();
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
  try {
    const res = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic.value.trim(),
        kbId: kbId.value === PUBLIC_SEARCH ? undefined : kbId.value,
        outputFormat: format.value,
        maxSteps: depth.value,
        template: template.value,
        agents: enabledAgents.value,
      }),
    });
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
  } catch {
    runError.value = t("common.networkError");
  } finally {
    running.value = false;
  }
}

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
function inferDagNodes(stepsList: AgentStep[], agents: string[], t2: TFunc): DagNode[] {
  return ROLE_ORDER.map((r, i) => {
    const step = stepsList.find((s) => s.role === r);
    return {
      id: r,
      name: roleLabel(t2, r),
      role: r as DagNode["role"],
      status: step ? (step.status as DagNode["status"]) : "pending",
      enabled: agents.includes(r),
      indegree: i === 0 ? 0 : 1,
    };
  });
}

function inferDagEdges(tplId: TemplateId): DagEdge[] {
  const tpl = TEMPLATES.find((x) => x.id === tplId) ?? TEMPLATES[0];
  const roles = tpl.agents;
  const edges: DagEdge[] = [];
  for (let i = 0; i < roles.length - 1; i++) {
    edges.push({ from: roles[i], to: roles[i + 1], conditional: tpl.conditionalExpand && roles[i] === "searcher" });
  }
  return edges;
}

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
    const d = await putAgentShareFetcher(task.value.id);
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

// GET share 配置（与 PUT 同路径不同方法，独立小函数避免 api 模块膨胀）
function putAgentShareFetcher(taskId: string): Promise<{ shareConfig: ShareConfig | null }> {
  return fetch(`/api/agent/tasks/${encodeURIComponent(taskId)}/share`).then((r) =>
    r.ok ? r.json() : { shareConfig: null }
  );
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
    <div class="card composer">
      <textarea
        v-model="topic"
        rows="2"
        class="topic-input"
        :placeholder="t('page.agent.s36')"
      />
      <div class="opts">
        <div class="opt kb-opt">
          <label>{{ t("page.agent.s0") }}</label>
          <el-select
            v-model="kbId"
            size="small"
            :placeholder="t('page.agent.s37')"
          >
            <el-option
              :value="PUBLIC_SEARCH"
              :label="t('page.agent.s1')"
            />
            <el-option
              v-for="kb in kbs"
              :key="kb.id"
              :value="kb.id"
              :label="kb.name"
            />
          </el-select>
        </div>
        <div class="opt">
          <label>{{ t("page.agent.s2") }}</label>
          <div class="fmt-group">
            <button
              v-for="f in formatOpts(t)"
              :key="f.value"
              type="button"
              class="fmt"
              :class="{ on: format === f.value }"
              @click="format = f.value"
            >
              {{ f.label }}
            </button>
          </div>
        </div>
        <div class="opt depth-opt">
          <label>{{ t("page.agent.s64") }} <span class="depth-val">{{ depth }}</span></label>
          <el-slider
            v-model="depth"
            :min="3"
            :max="10"
            :step="1"
            class="depth-slider"
          />
        </div>
        <el-button
          type="primary"
          class="run-btn"
          :disabled="running || !topic.trim()"
          @click="run"
        >
          <el-icon
            v-if="running"
            class="is-loading"
          >
            <Loading />
          </el-icon>
          <el-icon
            v-else
          >
            <VideoPlay />
          </el-icon>
          {{ running ? t("page.agent.s38") : t("page.agent.s39") }}
        </el-button>
      </div>
      <div class="opts second">
        <div class="opt">
          <label>{{ t("page.agent.s3") }}</label>
          <div class="tpl-list">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.id"
              type="button"
              class="tpl"
              :class="{ on: template === tpl.id }"
              :title="tpl.description"
              @click="pickTemplate(tpl.id)"
            >
              {{ tpl.name }}
            </button>
          </div>
        </div>
        <div class="opt">
          <label>{{ t("page.agent.s4") }}</label>
          <div class="agent-list">
            <button
              v-for="role in ROLE_ORDER"
              :key="role"
              type="button"
              class="agent-toggle"
              :class="{ on: enabledAgents.includes(role) }"
              @click="toggleAgent(role)"
            >
              <el-icon :size="11">
                <component :is="ROLE_ICON[role]" />
              </el-icon>
              {{ roleLabel(t, role) }}
              <el-icon
                v-if="enabledAgents.includes(role)"
                :size="10"
              >
                <Check />
              </el-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid">
      <!-- 主列：错误 / 时间线 / 报告 -->
      <div class="main-col">
        <div
          v-if="runError"
          class="run-error"
          role="alert"
        >
          <el-icon
            :size="14"
            class="err-ico"
          >
            <WarningFilled />
          </el-icon>
          <div>
            <p class="err-title">
              {{ t("page.agent.s85") }}
            </p>
            <p class="err-body">
              {{ runError }}
            </p>
          </div>
        </div>

        <div
          v-if="showTimeline"
          class="card"
        >
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <List />
            </el-icon>
            {{ t("page.agent.s65") }}
            <span
              v-if="task?.parallelExecuted"
              class="chip"
            >
              <el-icon :size="10">
                <MagicStick />
              </el-icon>
              {{ t("page.agent.s66") }}
            </span>
            <span
              v-if="task?.branchTriggered"
              class="chip"
            >
              <el-icon :size="10">
                <ArrowRight />
              </el-icon>
              {{ t("page.agent.s67") }}
            </span>
            <span
              v-if="running"
              class="chip running"
            >
              <el-icon
                :size="10"
                class="is-loading"
              >
                <Loading />
              </el-icon>
              {{ t("page.agent.s68") }}
            </span>
          </h3>
          <!-- DAG 工作流 -->
          <div class="dag">
            <span class="dag-label">DAG</span>
            <template
              v-for="(node, i) in dagNodes"
              :key="node.id"
            >
              <span
                class="dag-node"
                :class="node.status"
                :title="node.enabled ? undefined : t('page.agent.s44')"
              >
                <el-icon :size="11">
                  <component :is="ROLE_ICON[node.role]" />
                </el-icon>
                {{ node.name }}
                <el-icon
                  v-if="node.status === 'done'"
                  :size="10"
                >
                  <Check />
                </el-icon>
                <el-icon
                  v-else-if="node.status === 'running'"
                  :size="10"
                  class="is-loading"
                >
                  <Loading />
                </el-icon>
              </span>
              <span
                v-if="i < dagNodes.length - 1 && dagEdges.some((e) => e.from === node.id)"
                class="dag-edge"
                :class="{ conditional: dagEdges.find((e) => e.from === node.id)?.conditional }"
              >{{ dagEdges.find((e) => e.from === node.id)?.conditional ? "?" : "→" }}</span>
            </template>
          </div>
          <!-- 时间线 -->
          <div class="timeline">
            <div
              v-for="(step, i) in sortedSteps"
              :key="step.role"
              class="tl-item"
            >
              <span
                v-if="i < sortedSteps.length - 1"
                class="tl-line"
              />
              <span
                class="tl-dot"
                :class="step.status"
              >
                <el-icon
                  v-if="step.status === 'done'"
                  :size="13"
                >
                  <Check />
                </el-icon>
                <el-icon
                  v-else-if="step.status === 'running'"
                  :size="13"
                  class="is-loading"
                >
                  <Loading />
                </el-icon>
                <el-icon
                  v-else
                  :size="13"
                >
                  <component :is="ROLE_ICON[step.role]" />
                </el-icon>
              </span>
              <div class="tl-body">
                <div class="tl-head">
                  <span
                    class="tl-name"
                    :class="{ skipped: step.status === 'skipped' }"
                  >{{ step.name }}</span>
                  <span
                    v-if="step.status === 'running'"
                    class="tl-pct"
                  >{{ step.progress }}%</span>
                  <span
                    v-if="step.status === 'done'"
                    class="tl-done"
                  >{{ t("page.agent.s11") }}</span>
                  <span
                    v-if="step.status === 'skipped'"
                    class="tl-skip"
                  >{{ t("page.agent.s12") }}</span>
                </div>
                <div
                  v-if="step.status === 'running'"
                  class="tl-bar"
                >
                  <div
                    class="tl-bar-fill"
                    :style="{ width: `${step.progress}%` }"
                  />
                </div>
                <p
                  v-if="step.detail"
                  class="tl-detail"
                >
                  {{ step.detail }}
                </p>
                <pre
                  v-if="step.result && (step.status === 'done' || step.status === 'running')"
                  class="tl-result"
                >{{ step.result }}</pre>
              </div>
            </div>
          </div>
        </div>

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
                    {{ new Date(v.createdAt).toLocaleString("zh-CN", { hour12: false }) }}{{ v.author ? ` · ${v.author}` : "" }}
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
                    <span class="c-time">{{ new Date(c.createdAt).toLocaleString("zh-CN", { hour12: false }) }}</span>
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
                        <span class="c-time">{{ new Date(ch.createdAt).toLocaleString("zh-CN", { hour12: false }) }}</span>
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
                    <span class="c-time">{{ new Date(c.createdAt).toLocaleString("zh-CN", { hour12: false }) }}</span>
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
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="13"
              class="muted-ico"
            >
              <Clock />
            </el-icon>
            {{ t("page.agent.s73") }}
          </h3>
          <p
            v-if="history.length === 0"
            class="empty-hint"
          >
            {{ t("page.agent.s9") }}
          </p>
          <div
            v-else
            class="history"
          >
            <button
              v-for="h in history"
              :key="h.id"
              type="button"
              class="history-item"
              :class="{ active: task?.id === h.id }"
              @click="loadTask(h.id)"
            >
              <span class="h-topic">{{ h.topic }}</span>
              <el-icon
                :size="11"
                class="h-arrow"
              >
                <ArrowRight />
              </el-icon>
            </button>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="13"
              class="muted-ico"
            >
              <Search />
            </el-icon>
            {{ t("page.agent.s74") }}
            <span
              v-if="task"
              class="chip"
            >{{ task.citations.length }}</span>
          </h3>
          <p
            v-if="!task || task.citations.length === 0"
            class="empty-hint"
          >
            {{ t("page.agent.s10") }}
          </p>
          <div
            v-else
            class="cites"
          >
            <div
              v-for="c in task.citations"
              :key="c.n"
              class="cite"
              :class="{ active: highlightN === c.n }"
            >
              <div class="cite-head">
                <span class="n">{{ c.n }}</span>
                <el-icon
                  :size="11"
                  class="muted-ico"
                >
                  <Document />
                </el-icon>
                <span class="cite-title">{{ c.title }}</span>
              </div>
              <p class="cite-snippet">
                {{ c.snippet }}
              </p>
              <span class="cite-meta">{{ c.source }} · {{ t("page.agent.s75", { pct: (c.score * 100).toFixed(0) }) }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="durationText"
          class="duration"
        >
          <el-icon :size="12">
            <Clock />
          </el-icon>
          {{ durationText }}
        </div>
      </div>
    </div>

    <!-- 分享设置 -->
    <el-dialog
      v-model="shareOpen"
      :title="t('page.agent.s2')"
      width="420px"
    >
      <p class="dialog-desc">
        {{ t("page.agent.s84") }}
      </p>
      <div class="share-link">
        <div class="sl-label">
          {{ t("page.agent.s21") }}
        </div>
        <div class="sl-row">
          <code class="sl-url">{{ shareUrl }}</code>
          <el-button
            size="small"
            @click="copyText(shareUrl, 'share')"
          >
            <el-icon
              v-if="copied === 'share'"
            >
              <Check />
            </el-icon>
            <el-icon
              v-else
            >
              <CopyDocument />
            </el-icon>
          </el-button>
        </div>
        <div
          v-if="shareCfg"
          class="sl-views"
        >
          {{ t("page.agent.s57", { n: shareCfg.views }) }}{{ shareCfg.maxViews ? t("page.agent.s56", { n: shareCfg.maxViews }) : "" }}
        </div>
      </div>
      <div class="share-protect">
        <div>
          <div class="sp-title">
            {{ t("page.agent.s22") }}
          </div>
          <div class="sp-sub">
            {{ t("page.agent.s23") }}
          </div>
        </div>
        <el-switch v-model="shareEnabled" />
      </div>
      <div
        v-if="shareEnabled"
        class="share-fields"
      >
        <div>
          <label class="sf-label">{{ t("page.agent.s24") }}</label>
          <el-input
            v-model="shareDays"
            type="number"
            min="1"
            size="small"
            :placeholder="t('page.agent.s48')"
          />
        </div>
        <div>
          <label class="sf-label">{{ t("page.agent.s25") }}</label>
          <el-input
            v-model="sharePassword"
            size="small"
            :placeholder="t('page.agent.s49')"
          />
          <span
            v-if="shareCfg?.passwordHash && !sharePassword"
            class="sf-hint"
          >{{ t("page.agent.s26") }}</span>
        </div>
        <div>
          <label class="sf-label">{{ t("page.agent.s27") }}</label>
          <el-input
            v-model="shareMaxViews"
            type="number"
            min="1"
            size="small"
            :placeholder="t('page.agent.s50')"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="shareOpen = false">
          {{ t("page.agent.s28") }}
        </el-button>
        <el-button
          type="primary"
          :loading="shareSaving"
          @click="saveShare"
        >
          {{ t("common.save") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.agent-page {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.page-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.head-ico {
  color: hsl(var(--primary));
}
.sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.card {
  padding: 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  font-size: 13px;
  font-weight: 600;
}
.title-ico {
  color: hsl(var(--primary));
}
.muted-ico {
  color: hsl(var(--muted-foreground));
}
.topic-input {
  width: 100%;
  resize: none;
  padding: 12px 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  font: inherit;
  font-size: 14px;
  color: inherit;
}
.topic-input:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
}
.opts {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  margin-top: 16px;
}
.opts.second {
  padding-top: 16px;
  border-top: 1px solid hsl(var(--border));
  margin-top: 16px;
}
.opt label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.kb-opt {
  min-width: 180px;
  flex: 1;
}
.kb-opt .el-select {
  width: 100%;
}
.fmt-group {
  display: flex;
  padding: 2px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
}
.fmt {
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.fmt.on {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.depth-opt {
  min-width: 160px;
}
.depth-val {
  color: hsl(var(--primary));
}
.depth-slider {
  width: 160px;
}
.tpl-list,
.agent-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tpl {
  padding: 4px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.tpl.on {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.agent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  opacity: 0.6;
}
.agent-toggle.on {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  opacity: 1;
}
.run-btn {
  min-width: 108px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
@media (min-width: 1024px) {
  .grid {
    grid-template-columns: 2fr 1fr;
  }
}
.main-col,
.side-col {
  display: grid;
  gap: 24px;
  align-content: start;
}
.run-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid hsl(var(--destructive) / 0.3);
  border-radius: 16px;
  background: hsl(var(--destructive) / 0.05);
}
.err-ico {
  flex-shrink: 0;
  margin-top: 2px;
  color: hsl(var(--destructive));
}
.err-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--destructive));
}
.err-body {
  margin: 2px 0 0;
  overflow-wrap: break-word;
  font-size: 12px;
  color: hsl(var(--destructive) / 0.8);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 10px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
}
.chip.running {
  margin-left: auto;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.dag {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--muted) / 0.2);
}
.dag-label {
  margin-right: 4px;
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.dag-node {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.dag-node.done {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}
.dag-node.running {
  border-color: hsl(var(--primary));
  color: hsl(var(--primary));
}
.dag-node.skipped {
  border-style: dashed;
  opacity: 0.4;
}
.dag-edge {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.dag-edge.conditional {
  color: #f59e0b;
}
.timeline {
  display: grid;
  gap: 4px;
}
.tl-item {
  position: relative;
  display: flex;
  gap: 12px;
  padding-bottom: 16px;
}
.tl-item:last-child {
  padding-bottom: 0;
}
.tl-line {
  position: absolute;
  top: 36px;
  bottom: 0;
  left: 15px;
  width: 1px;
  background: hsl(var(--border));
}
.tl-dot {
  position: relative;
  z-index: 1;
  display: flex;
  height: 32px;
  width: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 2px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
}
.tl-dot.done {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.tl-dot.running {
  border-color: hsl(var(--primary));
  color: hsl(var(--primary));
}
.tl-dot.skipped {
  border-style: dashed;
  opacity: 0.5;
}
.tl-body {
  min-width: 0;
  flex: 1;
}
.tl-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tl-name {
  font-size: 13px;
  font-weight: 500;
}
.tl-name.skipped {
  text-decoration: line-through;
  opacity: 0.5;
}
.tl-pct {
  font-size: 12px;
  color: hsl(var(--primary));
}
.tl-done {
  font-size: 12px;
  color: hsl(142 71% 45%);
}
.tl-skip {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.tl-bar {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 9999px;
  background: hsl(var(--secondary, var(--muted)));
}
.tl-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  transition: width 0.3s;
}
.tl-detail {
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.tl-result {
  max-height: 128px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.4);
  font-size: 11px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
  white-space: pre-wrap;
}
.report-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.report-head .card-title {
  margin: 0;
}
.report-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.report-tabs {
  margin-bottom: 8px;
}
.report {
  font-size: 14px;
  line-height: 1.8;
}
.report :deep(h1),
.report :deep(h2),
.report :deep(h3) {
  margin: 20px 0 8px;
  font-weight: 600;
}
.report :deep(p) {
  margin: 8px 0;
}
.report :deep(ul),
.report :deep(ol) {
  padding-left: 20px;
}
.report :deep(pre) {
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.5);
  font-size: 13px;
}
.report :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
}
.report :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}
.report :deep(th),
.report :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 5px 9px;
  text-align: left;
}
.report :deep(.cite-chip) {
  display: inline-flex;
  height: 15px;
  min-width: 15px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  margin: 0 1px;
  border: 0;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
  vertical-align: 1px;
}
.report :deep(.cite-chip:hover) {
  background: hsl(var(--primary) / 0.3);
}
.edit-area {
  width: 100%;
  resize: vertical;
  padding: 12px 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.7;
  color: inherit;
}
.edit-area:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
}
.versions {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}
.version {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.version.active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.05);
}
.v-ico {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}
.v-main {
  min-width: 0;
  flex: 1;
}
.v-label {
  font-size: 12px;
  font-weight: 500;
}
.v-time {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.diff-title {
  font-size: 12px;
  font-weight: 500;
}
.diff-stat {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 11px;
}
.diff-stat .add {
  color: #16a34a;
}
.diff-stat .del {
  color: #dc2626;
}
.diff-view {
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.2);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.6;
}
.diff-line {
  padding: 2px 6px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.diff-line.add {
  background: rgb(34 197 94 / 0.1);
  color: #15803d;
}
.diff-line.remove {
  background: rgb(239 68 68 / 0.1);
  color: #b91c1c;
}
.diff-op {
  margin-right: 4px;
  user-select: none;
  color: hsl(var(--muted-foreground));
}
.comments {
  display: grid;
  gap: 16px;
}
.comment-new {
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.2);
}
.cn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cn-ico {
  color: hsl(var(--primary));
}
.cn-title {
  font-size: 12px;
  font-weight: 500;
}
.cn-select {
  width: 160px;
  margin-left: auto;
}
.cn-input {
  width: 100%;
  resize: none;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--background));
  font: inherit;
  font-size: 12px;
  color: inherit;
}
.cn-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.comment {
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.comment.reply {
  margin-left: 0;
}
.c-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.c-ava {
  display: flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.15);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.c-name {
  font-size: 12px;
  font-weight: 500;
}
.c-time {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.c-del {
  margin-left: auto;
}
.c-text {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-size: 12px;
}
.c-reply {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.c-reply:hover {
  color: hsl(var(--primary));
}
.c-reply-box {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.c-reply-input {
  height: 32px;
  min-width: 0;
  flex: 1;
  padding: 0 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--background));
  font: inherit;
  font-size: 12px;
}
.c-children {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid hsl(var(--border) / 0.6);
  display: grid;
  gap: 6px;
}
.c-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.n-badge {
  display: flex;
  height: 16px;
  min-width: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 20px;
  border-style: dashed;
  text-align: center;
}
.idle-ava {
  display: flex;
  height: 48px;
  width: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.idle-title {
  margin: 12px 0 0;
  font-size: 13px;
  font-weight: 500;
}
.idle-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.history {
  display: grid;
  gap: 2px;
}
.history-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.history-item:hover {
  background: hsl(var(--accent));
}
.history-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.h-topic {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.h-arrow {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}
.cites {
  display: grid;
  gap: 8px;
}
.cite {
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  transition: border-color 0.15s;
}
.cite.active {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.3);
}
.cite-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cite .n {
  display: flex;
  height: 16px;
  min-width: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.cite-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.cite-snippet {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 6px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.cite-meta {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.duration {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--muted) / 0.3);
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.empty-hint {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.dialog-desc {
  margin: 0 0 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.share-link {
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.2);
  margin-bottom: 12px;
}
.sl-label {
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.sl-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sl-url {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 4px;
  background: hsl(var(--background));
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.sl-views {
  margin-top: 6px;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.share-protect {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  margin-bottom: 12px;
}
.sp-title {
  font-size: 12px;
  font-weight: 500;
}
.sp-sub {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.share-fields {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.sf-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.sf-hint {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
</style>
