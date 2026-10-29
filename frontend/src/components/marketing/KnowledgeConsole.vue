<script setup lang="ts">
// 首页实时演示台（V5，复刻 src/components/marketing/knowledge-console.tsx）：
// 复刻登录后工作台的窗口壳（侧边栏/顶栏）+ 四个脚本化场景（仪表盘数字滚动/
// 知识库逐个就绪/问答流式打字/Agent 步进），进入视口自动播放一次，右上角
// 「重新演示」重播；系统开启减少动态效果时直达终态。纯展示，无 API 调用。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import {
  TrendCharts, MagicStick, ChatDotRound, User, Odometer, Key, Setting, Bell,
  Search, ArrowDown, Plus, Check, RefreshRight, Loading, Document, ChatLineRound,
  Collection, Promotion,
} from "@element-plus/icons-vue";
type Scene = "dashboard" | "kb" | "chat" | "agent";

const { t } = useTranslation();

// 与登录后 AppShell 相同的导航项（文案直接复用 app-shell 的键，一字不差）
const SCENES: { id: Scene; icon: object; labelKey: string }[] = [
  { id: "dashboard", icon: TrendCharts, labelKey: "page.app-shell.s6" },
  { id: "kb", icon: Collection, labelKey: "page.app-shell.s7" },
  { id: "chat", icon: ChatDotRound, labelKey: "page.app-shell.s8" },
  { id: "agent", icon: MagicStick, labelKey: "page.app-shell.s9" },
];

// 仅作展示的导航项（营造与真实工作台一致的信息架构）
const INERT_ITEMS: { icon: object; labelKey: string }[] = [
  { icon: User, labelKey: "page.app-shell.s11" },
  { icon: Odometer, labelKey: "page.app-shell.s13" },
  { icon: Key, labelKey: "page.app-shell.s15" },
  { icon: Setting, labelKey: "page.app-shell.s16" },
];

// ── 进视口检测（只触发一次）─────────────────────────────────────────────
const rootEl = ref<HTMLElement | null>(null);
const inView = ref(false);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  const el = rootEl.value;
  if (!el || typeof IntersectionObserver === "undefined") {
    inView.value = true;
    playScene();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        inView.value = true;
        observer?.disconnect();
      }
    },
    { threshold: 0.2 }
  );
  observer.observe(el);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  cancelTimeline?.();
});

// ── 减少动态效果 ────────────────────────────────────────────────────────
const reduced = ref(false);
let motionMedia: MediaQueryList | null = null;
const syncMotion = () => {
  if (motionMedia) reduced.value = motionMedia.matches;
};

onMounted(() => {
  motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncMotion();
  motionMedia.addEventListener("change", syncMotion);
});

onBeforeUnmount(() => motionMedia?.removeEventListener("change", syncMotion));

// ── 场景切换 + 重播 ─────────────────────────────────────────────────────
const scene = ref<Scene>("chat");
const runId = ref(0);
const activeLabelKey = computed(() => SCENES.find((s) => s.id === scene.value)!.labelKey);

// ── 时间轴调度器（毫秒级表；返回取消函数）────────────────────────────────
function startTimeline(build: (later: (delayMs: number, fn: () => void) => void) => void): () => void {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  build((delayMs, fn) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) fn();
      }, delayMs)
    );
  });
  return () => {
    cancelled = true;
    timers.forEach((timer) => clearTimeout(timer));
  };
}

/* ── 仪表盘场景 ───────────────────────────────────────────────────────── */
const dashProgress = ref(0);
const tasksShown = ref(0);
const dashStats = computed(() => [
  { label: t("page.dashboard.s8"), target: 128, chip: t("page.dashboard.s10") },
  { label: t("page.dashboard.s12"), target: -1, chip: "Pro" }, // -1 = ∞
  { label: t("page.dashboard.s14"), target: 41, chip: t("page.dashboard.s16") },
  { label: t("page.dashboard.s18"), target: 32, chip: t("page.dashboard.s20") },
]);

/* ── 知识库场景 ───────────────────────────────────────────────────────── */
const kbReady = ref<boolean[]>([false, false, false]);
const allReady = computed(() => kbReady.value.every(Boolean));
const kbNames = computed(() => [t("page.hero.s42"), t("page.hero.s43"), t("page.hero.s44")]);

/* ── 问答场景 ─────────────────────────────────────────────────────────── */
type ChatPhase = "idle" | "typing" | "sent" | "retrieving" | "streaming" | "done";
const chatInput = ref("");
const chatPhase = ref<ChatPhase>("idle");
const typedAnswer = ref("");
const chatDone = computed(() => chatPhase.value === "done");
const chatSources = computed(() => [
  { title: t("page.hero.s5"), page: t("page.hero.s6") },
  { title: t("page.hero.s7"), page: t("page.hero.s8") },
]);
const chatQuestion = computed(() => t("page.hero.s17"));

/* ── Agent 场景 ───────────────────────────────────────────────────────── */
const agentStates = ref<number[]>([0, 0, 0, 0]); // 0 待开始 / 1 进行中 / 2 完成
const reportReady = ref(false);
const agentRunning = computed(() => agentStates.value.some((s) => s === 1));
const agentSteps = computed(() => [t("page.agent.s40"), t("page.agent.s41"), t("page.agent.s42"), t("page.agent.s43")]);
const agentTopic = computed(() => t("page.agent.s35"));

/* ── 播放时间轴（场景/重播/视口/动效偏好变化时重建）────────────────────── */
let cancelTimeline: (() => void) | null = null;

function playScene() {
  cancelTimeline?.();
  const active = inView.value;
  const isReduced = reduced.value;
  const current = scene.value;

  if (current === "dashboard") {
    dashProgress.value = 0;
    tasksShown.value = 0;
    if (isReduced) {
      cancelTimeline = startTimeline((later) => later(0, () => { dashProgress.value = 1; tasksShown.value = 2; }));
      return;
    }
    if (!active) return;
    cancelTimeline = startTimeline((later) => {
      for (let i = 1; i <= 8; i++) later(250 + i * 90, () => (dashProgress.value = i / 8));
      later(1250, () => (tasksShown.value = 1));
      later(1550, () => (tasksShown.value = 2));
    });
  } else if (current === "kb") {
    kbReady.value = [false, false, false];
    if (isReduced) {
      cancelTimeline = startTimeline((later) => later(0, () => (kbReady.value = [true, true, true])));
      return;
    }
    if (!active) return;
    cancelTimeline = startTimeline((later) => {
      for (let i = 0; i < 3; i++) {
        later(450 + i * 550, () => (kbReady.value = kbReady.value.map((done, j) => (j === i ? true : done))));
      }
    });
  } else if (current === "chat") {
    const question = chatQuestion.value;
    const answer = t("page.hero.s18");
    chatInput.value = "";
    typedAnswer.value = "";
    chatPhase.value = "idle";
    if (isReduced) {
      cancelTimeline = startTimeline((later) =>
        later(0, () => {
          chatInput.value = "";
          typedAnswer.value = answer;
          chatPhase.value = "done";
        })
      );
      return;
    }
    if (!active) return;
    cancelTimeline = startTimeline((later) => {
      later(0, () => {
        chatInput.value = "";
        typedAnswer.value = "";
        chatPhase.value = "typing";
      });
      // 提问逐字输入
      const qStep = Math.max(14, Math.round(600 / question.length));
      for (let i = 1; i <= question.length; i++) {
        later(250 + i * qStep, () => (chatInput.value = question.slice(0, i)));
      }
      const questionEnd = 250 + question.length * qStep;
      later(questionEnd + 350, () => {
        chatInput.value = "";
        chatPhase.value = "sent";
      });
      later(questionEnd + 1000, () => (chatPhase.value = "retrieving"));
      // 回答流式输出（每 26ms 吐 3 个字符）
      const streamStart = questionEnd + 1900;
      later(streamStart, () => (chatPhase.value = "streaming"));
      const chunk = 3;
      const totalChunks = Math.ceil(answer.length / chunk);
      for (let c = 1; c <= totalChunks; c++) {
        later(streamStart + c * 26, () => (typedAnswer.value = answer.slice(0, c * chunk)));
      }
      later(streamStart + (totalChunks + 1) * 26 + 80, () => (chatPhase.value = "done"));
    });
  } else {
    agentStates.value = [0, 0, 0, 0];
    reportReady.value = false;
    if (isReduced) {
      cancelTimeline = startTimeline((later) => later(0, () => { agentStates.value = [2, 2, 2, 2]; reportReady.value = true; }));
      return;
    }
    if (!active) return;
    cancelTimeline = startTimeline((later) => {
      for (let i = 0; i < 4; i++) {
        later(400 + i * 600, () => (agentStates.value = agentStates.value.map((s, j) => (j === i ? 1 : s))));
        later(400 + i * 600 + 550, () => (agentStates.value = agentStates.value.map((s, j) => (j === i ? 2 : s))));
      }
      later(400 + 3 * 600 + 550 + 450, () => (reportReady.value = true));
    });
  }
}

watch([scene, runId, inView, reduced], () => playScene());
</script>

<template>
  <div
    ref="rootEl"
    class="console"
  >
    <!-- 窗口标题栏 -->
    <div class="titlebar">
      <span class="dot red" />
      <span class="dot yellow" />
      <span class="dot green" />
      <span class="tb-label">
        KnowledgeAI · {{ t("page.hero.s22") }}
        <span
          aria-hidden
          class="pulse-wrap"
        >
          <span class="pulse-ring" />
          <span class="pulse-dot" />
        </span>
      </span>
      <button
        type="button"
        class="replay"
        @click="runId++"
      >
        <el-icon :size="11">
          <RefreshRight />
        </el-icon>
        {{ t("page.hero.s36") }}
      </button>
    </div>

    <div class="frame">
      <!-- 侧边栏（复刻登录后 AppShell） -->
      <aside class="side">
        <div class="brand-row">
          <span class="brand-ava">
            <el-icon :size="12">
              <MagicStick />
            </el-icon>
          </span>
          <span class="brand-text">KnowledgeAI</span>
        </div>
        <div class="ws-row">
          <span class="ws-dot" />
          <span class="ws-name">{{ t("page.hero.s47") }}</span>
          <el-icon
            :size="11"
            class="ws-arrow"
          >
            <ArrowDown />
          </el-icon>
        </div>

        <div class="nav-group">
          <div class="nav-title">
            {{ t("page.app-shell.s5") }}
          </div>
          <button
            v-for="item in SCENES"
            :key="item.id"
            type="button"
            class="nav-item"
            :class="{ active: scene === item.id }"
            :aria-pressed="scene === item.id"
            :aria-label="t(item.labelKey)"
            @click="scene = item.id"
          >
            <el-icon :size="13">
              <component :is="item.icon" />
            </el-icon>
            {{ t(item.labelKey) }}
            <span
              v-if="item.id === 'agent'"
              aria-hidden
              class="nav-new"
            >{{ t("page.app-shell.s26") }}</span>
          </button>
        </div>

        <div class="nav-group">
          <div class="nav-title">
            {{ t("page.app-shell.s10") }}
          </div>
          <div
            v-for="item in INERT_ITEMS.slice(0, 2)"
            :key="item.labelKey"
            class="nav-inert"
          >
            <el-icon :size="13">
              <component :is="item.icon" />
            </el-icon>
            {{ t(item.labelKey) }}
          </div>
        </div>

        <div class="nav-group">
          <div class="nav-title">
            {{ t("page.app-shell.s14") }}
          </div>
          <div
            v-for="item in INERT_ITEMS.slice(2)"
            :key="item.labelKey"
            class="nav-inert"
          >
            <el-icon :size="13">
              <component :is="item.icon" />
            </el-icon>
            {{ t(item.labelKey) }}
          </div>
        </div>
      </aside>

      <div class="stage-col">
        <!-- 顶栏 -->
        <div class="topbar">
          <span class="page-label">{{ t(activeLabelKey) }}</span>
          <div class="topbar-right">
            <span class="fake-search">
              <el-icon :size="11">
                <Search />
              </el-icon>
              {{ t("page.app-shell.s2") }}
              <span class="kbd">⌘K</span>
            </span>
            <span class="bell-wrap">
              <el-icon
                :size="13"
                class="bell"
              >
                <Bell />
              </el-icon>
              <span class="bell-dot" />
            </span>
            <span class="user-chip">
              <span class="user-ava">{{ t("page.hero.s46").slice(0, 1) }}</span>
              <span class="user-name">{{ t("page.hero.s46") }}</span>
              <el-icon
                :size="11"
                class="ws-arrow"
              >
                <ArrowDown />
              </el-icon>
            </span>
          </div>
        </div>

        <!-- 场景区（runId 变化重挂载 → 动画从头播放） -->
        <div
          :key="`${scene}-${runId}`"
          class="stage"
        >
          <!-- 仪表盘 -->
          <div
            v-if="scene === 'dashboard'"
            class="scene"
          >
            <div class="sc-head">
              <div>
                <div class="sc-title">
                  {{ t("page.dashboard.s29", { name: t("page.hero.s46") }) }} 👋
                </div>
                <div class="sc-sub">
                  {{ t("page.dashboard.s30") }}
                </div>
              </div>
              <div class="sc-actions">
                <span class="ghost-chip">
                  <el-icon :size="10"><Plus /></el-icon>
                  {{ t("page.dashboard.s27") }}
                </span>
                <span class="grad-chip">
                  <el-icon :size="10"><MagicStick /></el-icon>
                  {{ t("page.dashboard.s28") }}
                </span>
              </div>
            </div>
            <div class="mini-stats">
              <div
                v-for="stat in dashStats"
                :key="stat.label"
                class="mini-stat"
              >
                <span class="chip">{{ stat.chip }}</span>
                <div class="mini-val">
                  {{ stat.target < 0 ? "∞" : Math.round(stat.target * dashProgress) }}
                </div>
                <div class="mini-label">
                  {{ stat.label }}
                </div>
              </div>
            </div>
            <div class="task-card">
              <div class="task-head">
                <el-icon
                  :size="13"
                  class="title-ico"
                >
                  <MagicStick />
                </el-icon>
                {{ t("page.dashboard.s33") }}
                <span class="task-head-sub">{{ t("page.dashboard.s34") }}</span>
              </div>
              <div class="task-list">
                <div
                  v-for="index in 2"
                  :key="index"
                  class="task-row"
                  :class="{ show: tasksShown >= index }"
                >
                  <el-icon
                    :size="13"
                    class="muted"
                  >
                    <ChatLineRound />
                  </el-icon>
                  <span class="task-topic">{{ t("page.agent.s35") }}</span>
                  <span class="task-bar"><span class="task-bar-fill" /></span>
                  <span class="badge ok">{{ t("page.dashboard.s22") }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 知识库 -->
          <div
            v-else-if="scene === 'kb'"
            class="scene"
          >
            <div class="sc-head">
              <div>
                <div class="sc-title">
                  {{ t("page.kb.title") }}
                </div>
                <div class="sc-sub">
                  {{ t("page.kb.subtitle", { count: 41 }) }}
                </div>
              </div>
              <span class="grad-chip">
                <el-icon :size="10"><Plus /></el-icon>
                {{ t("page.dashboard.s27") }}
              </span>
            </div>
            <div class="kb-grid">
              <div
                v-for="(name, index) in kbNames"
                :key="name"
                class="kb-card"
              >
                <span class="kb-ava">{{ name.slice(0, 1).toUpperCase() }}</span>
                <div class="kb-name">
                  {{ name }}
                </div>
                <div class="kb-desc">
                  {{ t("page.kb.noDesc") }}
                </div>
                <div class="kb-meta">
                  <span
                    class="kb-stats"
                    :class="{ show: kbReady[index] }"
                  >
                    <el-icon :size="11"><Document /></el-icon>
                    {{ t("page.kb.s2", { count: 1 }) }}
                    <el-icon :size="11"><ChatLineRound /></el-icon>
                    {{ t("page.kb.s3", { count: 128 }) }}
                  </span>
                  <span class="kb-status">
                    <span
                      v-if="kbReady[index]"
                      class="badge ok"
                    >{{ t("page.kb.s5") }}</span>
                    <span
                      v-else
                      class="badge warn"
                    >
                      <el-icon
                        :size="10"
                        class="is-loading"
                      ><Loading /></el-icon>
                      {{ t("page.kb.s4") }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div
              class="kb-done"
              :class="{ show: allReady }"
            >
              <span class="badge ok big">
                <el-icon :size="11"><Check /></el-icon>
                {{ t("page.hero.s24") }} · {{ t("page.hero.s40") }}
              </span>
            </div>
          </div>

          <!-- 问答 -->
          <div
            v-else-if="scene === 'chat'"
            class="chat-scene"
          >
            <div class="chat-main">
              <div class="kb-select-row">
                <span class="ghost-chip">
                  <el-icon
                    :size="11"
                    class="title-ico"
                  ><Collection /></el-icon>
                  {{ t("page.hero.s45") }}
                </span>
                <span class="badge ok">{{ t("page.chat.s71", { count: 3 }) }}</span>
              </div>

              <div class="chat-msgs">
                <div
                  v-if="chatPhase === 'idle' || chatPhase === 'typing'"
                  class="chat-empty"
                >
                  <span class="empty-ava">
                    <el-icon :size="15"><MagicStick /></el-icon>
                  </span>
                  <div class="chat-empty-title">
                    {{ t("page.chat.s8") }}
                  </div>
                  <div class="chat-empty-sub">
                    {{ t("page.chat.s33") }}
                  </div>
                </div>
                <div
                  v-else
                  class="chat-thread"
                >
                  <div class="q-row">
                    <div class="q-bubble">
                      {{ chatQuestion }}
                    </div>
                  </div>
                  <div class="a-row">
                    <span class="a-ava">
                      <el-icon :size="12"><MagicStick /></el-icon>
                    </span>
                    <div class="a-bubble">
                      <span v-if="chatPhase === 'sent' || chatPhase === 'retrieving'">
                        <el-icon
                          :size="11"
                          class="is-loading"
                        ><Loading /></el-icon>
                        {{ t("page.hero.s34") }}
                      </span>
                      <span v-else>
                        {{ typedAnswer }}<span
                          v-if="chatPhase === 'streaming'"
                          class="caret"
                        /><span
                          v-if="chatDone"
                          class="cites"
                        >
                          <span class="cite-n">1</span>
                          <span class="cite-n">2</span>
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="chat-input-area">
                <span class="ws-pill">
                  <el-icon :size="10"><Search /></el-icon>
                  {{ t("page.chat.s74") }}
                </span>
                <div class="chat-input">
                  <span class="chat-input-text">
                    <template v-if="chatPhase === 'typing'">
                      {{ chatInput }}<span class="caret" />
                    </template>
                    <template v-else-if="chatPhase === 'idle'">
                      <span class="dim">{{ t("page.chat.s55", { extra: "" }) }}</span>
                    </template>
                    <template v-else>
                      {{ chatInput || t("page.chat.s55", { extra: "" }) }}
                    </template>
                  </span>
                  <span class="send-dot">
                    <el-icon :size="10"><Promotion /></el-icon>
                  </span>
                </div>
              </div>
            </div>

            <!-- 引用来源面板（复刻真实问答页右侧栏） -->
            <div class="chat-sources">
              <div class="src-head">
                <el-icon
                  :size="11"
                  class="title-ico"
                >
                  <Document />
                </el-icon>
                {{ t("page.chat.s5") }}
                <span class="src-count">{{ chatDone ? 2 : 0 }}</span>
              </div>
              <div class="src-body">
                <div
                  v-if="chatDone"
                  class="src-list"
                >
                  <div
                    v-for="source in chatSources"
                    :key="source.title"
                    class="src-item"
                  >
                    <div class="src-title">
                      {{ source.title }}
                    </div>
                    <div class="src-page">
                      {{ source.page }}
                    </div>
                  </div>
                </div>
                <p
                  v-else
                  class="src-empty"
                >
                  {{ t("page.chat.s80") }}
                </p>
              </div>
            </div>
          </div>

          <!-- Agent -->
          <div
            v-else
            class="scene"
          >
            <div>
              <div class="sc-title with-ico">
                <el-icon
                  :size="14"
                  class="title-ico"
                >
                  <MagicStick />
                </el-icon>
                {{ t("page.agent.s62") }}
              </div>
              <div class="sc-sub">
                {{ t("page.agent.s63") }}
              </div>
            </div>
            <div class="agent-input">
              <span class="agent-topic">{{ agentTopic }}</span>
              <span
                class="agent-run"
                :class="{ running: agentRunning }"
              >
                <el-icon
                  v-if="agentRunning"
                  :size="11"
                  class="is-loading"
                ><Loading /></el-icon>
                <el-icon
                  v-else
                  :size="11"
                ><MagicStick /></el-icon>
                {{ agentRunning ? t("page.agent.s38") : t("page.agent.s39") }}
              </span>
            </div>
            <div class="agent-steps">
              <div class="steps-head">
                <el-icon
                  :size="13"
                  class="title-ico"
                >
                  <TrendCharts />
                </el-icon>
                {{ t("page.agent.s65") }}
              </div>
              <div class="step-list">
                <div
                  v-for="(step, index) in agentSteps"
                  :key="step"
                  class="step-row"
                >
                  <span
                    class="step-dot"
                    :class="{ done: agentStates[index] === 2, running: agentStates[index] === 1 }"
                  >
                    <el-icon
                      v-if="agentStates[index] === 2"
                      :size="10"
                    ><Check /></el-icon>
                    <el-icon
                      v-else-if="agentStates[index] === 1"
                      :size="10"
                      class="is-loading"
                    ><Loading /></el-icon>
                    <template v-else>{{ index + 1 }}</template>
                  </span>
                  <span class="step-name">{{ step }}</span>
                  <span
                    class="step-state"
                    :class="{ ok: agentStates[index] === 2 }"
                  >
                    {{ agentStates[index] === 2 ? t("page.agent.s11") : agentStates[index] === 1 ? t("page.agent.s68") : "" }}
                  </span>
                </div>
              </div>
            </div>
            <div
              class="agent-done"
              :class="{ show: reportReady }"
            >
              <el-icon
                :size="14"
                class="ok-text"
              >
                <Document />
              </el-icon>
              <span class="ok-text agent-done-text">{{ t("page.hero.s41") }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 外观即 hero 演示台形态（唯一消费方是 MktHero）：20px 圆角 + shadow-lg +
   更实的描边此前由父组件 :deep() 覆盖，现收敛到这里，避免父组件依赖内部类名。 */
.console {
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.9);
  border-radius: var(--radius-xl);
  background: hsl(var(--card) / 0.9);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(16px);
  text-align: left;
}
.titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid hsl(var(--border) / 0.7);
  background: hsl(var(--muted) / 0.3);
}
.dot {
  height: 10px;
  width: 10px;
  border-radius: var(--radius-full);
}
.dot.red { background: hsl(var(--destructive) / 0.5); }
.dot.yellow { background: hsl(var(--warning-bright) / 0.6); }
.dot.green { background: hsl(var(--positive) / 0.6); }
.tb-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.pulse-wrap {
  position: relative;
  display: flex;
  height: 6px;
  width: 6px;
}
.pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  background: hsl(var(--positive) / 0.7);
  animation: ping 1.5s var(--ease-out-quad) infinite;
}
.pulse-dot {
  position: relative;
  height: 6px;
  width: 6px;
  border-radius: var(--radius-full);
  background: hsl(var(--positive));
}

.replay {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 4px 10px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-full);
  background: hsl(var(--background) / 0.7);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.replay:hover {
  border-color: hsl(var(--primary) / 0.4);
  color: hsl(var(--foreground));
}
.frame {
  display: flex;
}
.side {
  display: none;
  width: 176px;
  flex-shrink: 0;
  flex-direction: column;
  padding: 12px;
  border-right: 1px solid hsl(var(--border) / 0.7);
  background: hsl(var(--muted) / 0.2);
}
@media (min-width: 640px) {
  .side {
    display: flex;
  }
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.brand-ava {
  display: flex;
  height: 24px;
  width: 24px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.brand-text {
  font-size: 12px;
  font-weight: 600;
}
.ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 6px 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-sm);
  background: hsl(var(--background));
}
.ws-dot {
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
}
.ws-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
}
.ws-arrow {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}
.nav-group {
  margin-top: 12px;
}
.nav-title {
  padding: 0 8px 4px;
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.nav-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-align: left;
}
.nav-item:hover {
  background: hsl(var(--accent) / 0.5);
  color: hsl(var(--foreground));
}
.nav-item.active {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground, var(--foreground)));
}
.nav-new {
  margin-left: auto;
  padding: 1px 4px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.1);
  font-size: 9px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.nav-inert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.7);
}
.stage-col {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.7);
}
.page-label {
  font-size: 13px;
  font-weight: 600;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.fake-search {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-sm);
  background: hsl(var(--background));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
@media (min-width: 768px) {
  .fake-search {
    display: inline-flex;
  }
}
.kbd {
  padding: 0 4px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 4px;
  background: hsl(var(--muted) / 0.4);
  font-size: 9px;
}
.bell-wrap {
  position: relative;
  display: inline-flex;
}
.bell {
  color: hsl(var(--muted-foreground));
}
.bell-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  height: 6px;
  width: 6px;
  border-radius: var(--radius-full);
  background: hsl(var(--destructive));
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 6px;
}
.user-ava {
  display: flex;
  height: 24px;
  width: 24px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}
.user-name {
  display: none;
  font-size: 11px;
  font-weight: 500;
}
@media (min-width: 640px) {
  .user-name {
    display: inline;
  }
}
.stage {
  min-height: 310px;
  flex: 1;
  padding: 16px;
}
.scene {
  display: grid;
  gap: 14px;
}
.sc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.sc-title {
  font-size: 13px;
  font-weight: 600;
}
.sc-title.with-ico {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sc-sub {
  margin-top: 2px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.sc-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
.ghost-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-sm);
  background: hsl(var(--background));
  font-size: 11px;
  font-weight: 500;
}
.grad-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  font-size: 11px;
  font-weight: 500;
  color: #fff;
}
.mini-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 1024px) {
  .mini-stats {
    grid-template-columns: repeat(4, 1fr);
  }
}
.mini-stat {
  padding: 10px 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background));
}
.chip {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--muted));
  font-size: 9px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.mini-val {
  margin-top: 6px;
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mini-label {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.task-card {
  padding: 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background));
}
.task-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
}
.task-head-sub {
  margin-left: auto;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.task-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: hsl(var(--muted) / 0.25);
  opacity: 0;
  transform: translateY(4px);
  transition: all 0.5s;
  visibility: hidden;
}
.task-row.show {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
.muted {
  color: hsl(var(--muted-foreground));
}
.task-topic {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
}
.task-bar {
  height: 4px;
  width: 64px;
  flex-shrink: 0;
  margin-left: auto;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: hsl(var(--muted));
}
.task-bar-fill {
  display: block;
  height: 100%;
  width: 100%;
  border-radius: var(--radius-full);
  background: hsl(var(--positive));
}
.badge { gap: 4px; padding: 1px 6px; font-size: 9px; font-weight: 500; }

.badge.ok { background: hsl(var(--positive) / 0.1); color: hsl(var(--positive-text)); }
.badge.warn { background: hsl(var(--warning-bright) / 0.1); color: hsl(var(--warning-text)); }
.badge.big {
  padding: 4px 12px;
  font-size: 11px;
}
.title-ico {
  color: hsl(var(--primary));
}
.kb-grid {
  display: grid;
  gap: 10px;
}
@media (min-width: 640px) {
  .kb-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
.kb-card {
  padding: 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: linear-gradient(135deg, hsl(var(--accent) / 0.5), hsl(var(--card)), hsl(var(--card)));
}
.kb-ava {
  display: flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.kb-name {
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}
.kb-desc {
  margin-top: 2px;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.kb-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.kb-stats {
  display: flex;
  align-items: center;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.5s;
  visibility: hidden;
}
.kb-stats.show {
  visibility: visible;
  opacity: 1;
}
.kb-status {
  flex-shrink: 0;
  margin-left: auto;
}
.kb-done {
  display: flex;
  justify-content: center;
  padding-top: 2px;
  opacity: 0;
  transform: translateY(6px);
  transition: all 0.5s;
  visibility: hidden;
}
.kb-done.show {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
.chat-scene {
  display: flex;
  height: 100%;
  gap: 12px;
}
.chat-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.kb-select-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-msgs {
  flex: 1;
  margin-top: 12px;
}
.chat-empty {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.empty-ava {
  display: flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.chat-empty-title {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
}
.chat-empty-sub {
  max-width: 320px;
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
}
.chat-thread {
  display: grid;
  gap: 12px;
}
.q-row {
  display: flex;
  justify-content: flex-end;
}
.q-bubble {
  display: flex;
  min-height: 32px;
  align-items: center;
  padding: 6px 12px;
  border-radius: var(--radius-lg) 4px var(--radius-lg) var(--radius-lg);
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 12px;
}
.a-row {
  display: flex;
  gap: 8px;
}
.a-ava {
  display: flex;
  height: 24px;
  width: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border-radius: 10px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.a-bubble {
  min-height: 36px;
  min-width: 0;
  flex: 1;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 4px var(--radius-lg) var(--radius-lg) var(--radius-lg);
  background: hsl(var(--background));
  font-size: 12px;
  line-height: 1.7;
}
.caret {
  display: inline-block;
  height: 12px;
  width: 2px;
  margin-left: 2px;
  vertical-align: middle;
  background: hsl(var(--foreground) / 0.7);
  animation: pulse 1s step-end infinite;
}
.cites {
  display: inline-flex;
  gap: 4px;
  margin-left: 6px;
  vertical-align: baseline;
}
.cite-n {
  display: inline-flex;
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
.chat-input-area {
  margin-top: 12px;
}
.ws-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-full);
  background: hsl(var(--muted) / 0.25);
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.chat-input {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background));
}
.chat-input-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: hsl(var(--foreground));
}
.dim {
  opacity: 0.6;
}
.send-dot {
  display: flex;
  height: 20px;
  width: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.chat-sources {
  display: none;
  width: 208px;
  flex-shrink: 0;
  flex-direction: column;
  padding: 10px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.1);
}
@media (min-width: 1024px) {
  .chat-sources {
    display: flex;
  }
}
.src-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
}
.src-count {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--muted));
  font-size: 9px;
  color: hsl(var(--muted-foreground));
}
.src-body {
  flex: 1;
  margin-top: 8px;
}
.src-list {
  display: grid;
  gap: 8px;
}
.src-item {
  padding: 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius-sm);
  background: hsl(var(--background));
}
.src-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 500;
}
.src-page {
  margin-top: 2px;
  font-size: 9px;
  color: hsl(var(--muted-foreground));
}
.src-empty {
  padding-top: 24px;
  text-align: center;
  font-size: 10px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
}
.agent-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background));
}
.agent-topic {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.agent-run {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  transition: background 0.2s;
}
.agent-run.running {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}
.agent-steps {
  padding: 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background) / 0.7);
}
.steps-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.step-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: hsl(var(--muted) / 0.25);
}
.step-dot {
  display: flex;
  height: 20px;
  width: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-full);
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: 9px;
  font-weight: 700;
}
.step-dot.done {
  border-color: transparent;
  background: hsl(var(--positive));
  color: hsl(var(--background));
}
.step-dot.running {
  border-color: transparent;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.step-name {
  font-size: 11px;
  font-weight: 500;
}
.step-state {
  margin-left: auto;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.step-state.ok {
  font-weight: 500;
  color: hsl(var(--positive-text));
}
.agent-done {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid hsl(var(--positive) / 0.3);
  border-radius: var(--radius);
  background: hsl(var(--positive) / 0.1);
  opacity: 0;
  transform: translateY(6px);
  transition: all 0.5s;
  visibility: hidden;
}
.agent-done.show {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
.agent-done-text {
  font-size: 12px;
  font-weight: 500;
}
.ok-text {
  color: hsl(var(--positive-text));
}

/* 宽屏给右侧演示区让位（原由 MktHero 的 :deep() 覆盖，收敛进组件：
   放在样式块末尾，才能压过上面 .stage / .side 的基线值） */
@media (min-width: 1180px) {
  .side {
    width: 150px;
  }
  .stage {
    min-height: 330px;
    padding: 14px;
  }
}
</style>
