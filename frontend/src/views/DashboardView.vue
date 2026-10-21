<script setup lang="ts">
// 工作台（V2，复刻 src/app/(app)/dashboard/page.tsx）：4 统计卡 + 用量趋势 +
// Agent 任务（角色可见）+ 最近问答。5 个 API 并发拉取（契约冻结）。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { ChatDotRound, Check, Collection, Document, Loading, Odometer } from "@element-plus/icons-vue";
import UsageChart from "@/components/UsageChart.vue";
import { api } from "@/api/client";
import { formatRelative } from "@shared/format";
import { currentPlan } from "@/lib/workspace-store";
import { planLabelKey } from "@/lib/plan";

interface CurrentUser { name: string; role: string }
interface KbItem { id: string; name: string; stats?: { total: number; ready: number; processing: number; chunks: number } }
interface Conversation { id: string; kbId: string; title: string; messages: { role: string; content: string; createdAt: number }[]; updatedAt: number }
interface AgentTask { id: string; topic: string; status: "queued" | "running" | "done" | "failed"; steps: { role: string; status: string; progress: number }[]; updatedAt: number }

const AGENT_ROLES = ["owner", "admin", "editor"];

const { t } = useTranslation();

const user = ref<CurrentUser | null>(null);
const kbs = ref<KbItem[]>([]);
const convs = ref<Conversation[]>([]);
const tasks = ref<AgentTask[]>([]);
const qaUsed = ref(0);
const qaLimit = ref<number | null>(null);
const trend = ref<{ date: string; qa: number }[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [meRes, kbRes, usageRes, convRes, taskRes] = await Promise.all([
      api.get<{ user?: CurrentUser }>("/api/auth/me").catch(() => null),
      api.get<{ kbs?: KbItem[] }>("/api/knowledge-base").catch(() => null),
      api.get<{ usage?: { qaUsed?: number; qaLimit?: number | null; trend?: { date: string; qa: number }[] } }>("/api/usage").catch(() => null),
      api.get<{ conversations?: Conversation[] }>("/api/chat/conversations?limit=5").catch(() => null),
      api.get<{ tasks?: AgentTask[] }>("/api/agent/tasks").catch(() => null),
    ]);
    if (meRes?.user) user.value = meRes.user;
    kbs.value = kbRes?.kbs ?? [];
    const u = usageRes?.usage;
    if (u) {
      qaUsed.value = u.qaUsed ?? 0;
      qaLimit.value = u.qaLimit ?? null;
      trend.value = (u.trend ?? []).map((x) => ({ date: x.date, qa: x.qa }));
    }
    convs.value = convRes?.conversations ?? [];
    tasks.value = taskRes?.tasks ?? [];
  } finally {
    loading.value = false;
  }
});

const totalDocs = computed(() => kbs.value.reduce((sum, kb) => sum + (kb.stats?.total ?? 0), 0));
const kbMap = computed(() => new Map(kbs.value.map((kb) => [kb.id, kb.name])));

// 套餐读后端当前工作区套餐（升级写 workspace.plan，user.plan 不随升级变化）
const planLabel = computed(() => {
  const key = planLabelKey(currentPlan.value);
  return key ? t(key) : currentPlan.value || t("page.dashboard.s13");
});

const stats = computed(() => [
  {
    label: t("page.dashboard.s8"), value: qaUsed.value.toLocaleString(), sub: t("page.dashboard.s9"),
    trend: qaLimit.value ? t("page.dashboard.s10") : t("page.dashboard.s11"), muted: false,
    icon: ChatDotRound,
  },
  {
    label: t("page.dashboard.s12"),
    value: qaLimit.value === null ? "∞" : (qaLimit.value - qaUsed.value).toLocaleString(),
    sub: qaLimit.value === null ? "" : t("page.dashboard.s9"),
    trend: planLabel.value, muted: true,
    icon: Odometer,
  },
  {
    label: t("page.dashboard.s14"), value: String(kbs.value.length), sub: t("page.dashboard.s15"),
    trend: kbs.value.length > 0 ? t("page.dashboard.s16") : t("page.dashboard.s17"), muted: false,
    icon: Collection,
  },
  {
    label: t("page.dashboard.s18"), value: totalDocs.value.toLocaleString(), sub: t("page.dashboard.s19"),
    trend: totalDocs.value > 0 ? t("page.dashboard.s20") : t("page.dashboard.s17"), muted: false,
    icon: Document,
  },
]);

const recentQA = computed(() =>
  convs.value.slice(0, 5).map((c) => {
    const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
    return {
      id: c.id, kbId: c.kbId,
      q: lastUser?.content ?? c.title,
      kb: kbMap.value.get(c.kbId) ?? t("page.dashboard.s21"),
      time: formatRelative(c.updatedAt),
    };
  })
);

function taskProgress(task: AgentTask): number {
  if (task.status === "done") return 100;
  if (task.status === "queued") return 0;
  const done = task.steps.filter((s) => s.status === "done").length;
  return task.steps.length > 0 ? Math.round((done / task.steps.length) * 100) : 0;
}

function taskStepLabel(task: AgentTask): string {
  if (task.status === "done") return t("page.dashboard.s22");
  if (task.status === "failed") return t("page.dashboard.s23");
  if (task.status === "queued") return t("page.dashboard.s24");
  const running = task.steps.find((s) => s.status === "running");
  const labels: Record<string, string> = {
    planner: t("page.dashboard.s4"), searcher: t("page.dashboard.s5"),
    analyzer: t("page.dashboard.s6"), writer: t("page.dashboard.s7"),
  };
  return running ? labels[running.role] ?? running.role : t("page.dashboard.s25");
}

const canSeeAgent = computed(() => !!user.value && AGENT_ROLES.includes(user.value.role));
const chartData = computed(() => (trend.value.length > 0 ? trend.value.map((x) => x.qa) : undefined));
const chartLabels = computed(() => (trend.value.length > 0 ? trend.value.map((x) => x.date) : undefined));
</script>

<template>
  <div class="wrap">
    <div class="welcome">
      <div>
        <h2>
          <template v-if="loading">
            <span
              class="sk"
              style="width: 192px; height: 28px"
            />
          </template>
          <template v-else>
            {{ t("page.dashboard.s29", { name: user?.name ?? t("page.dashboard.s26") }) }} 👋
          </template>
        </h2>
        <p class="sub">
          {{ t("page.dashboard.s30") }}
        </p>
      </div>
      <div class="welcome-actions">
        <a
          href="/knowledge-base"
          class="btn outline"
        >+ {{ t("page.dashboard.s27") }}</a>
        <a
          href="/chat"
          class="btn primary"
        >{{ t("page.dashboard.s28") }}</a>
      </div>
    </div>

    <div class="stats">
      <div
        v-for="s in stats"
        :key="s.label"
        class="card stat"
      >
        <div class="stat-head">
          <span class="stat-icon">
            <el-icon :size="18"><component :is="s.icon" /></el-icon>
          </span>
          <span
            v-if="!s.muted"
            class="stat-trend up"
          >{{ s.trend }}</span>
          <span
            v-else
            class="badge"
          >{{ s.trend }}</span>
        </div>
        <div class="stat-value-row">
          <span
            v-if="loading"
            class="sk"
            style="width: 64px; height: 28px"
          />
          <span
            v-else
            class="stat-value"
          >{{ s.value }}</span>
          <span class="stat-sub">{{ s.sub }}</span>
        </div>
        <p class="stat-label">
          {{ s.label }}
        </p>
      </div>
    </div>

    <div class="grid3">
      <div
        class="card"
        :class="canSeeAgent ? 'span2' : 'span3'"
      >
        <div class="card-head between">
          <h3>{{ t("page.dashboard.s0") }}</h3>
          <div class="chart-meta">
            <span class="chart-dot">{{ t("page.dashboard.s31") }}</span>
            <span class="badge success">{{ t("page.dashboard.s32", { days: trend.length || 14 }) }}</span>
          </div>
        </div>
        <div class="card-body">
          <div
            v-if="loading"
            class="sk"
            style="height: 220px"
          />
          <UsageChart
            v-else
            :data="chartData"
            :labels="chartLabels"
          />
        </div>
      </div>

      <div
        v-if="canSeeAgent"
        class="card"
      >
        <div class="card-head between">
          <h3>{{ t("page.dashboard.s33") }}</h3>
          <a
            href="/agent"
            class="more-link"
          >{{ t("page.dashboard.s34") }} →</a>
        </div>
        <div class="card-body">
          <template v-if="loading">
            <div
              class="sk"
              style="height: 64px; margin-bottom: 12px"
            />
            <div
              class="sk"
              style="height: 64px"
            />
          </template>
          <div
            v-else-if="tasks.length === 0"
            class="empty"
          >
            <p>{{ t("page.dashboard.s1") }}</p>
            <a
              href="/agent"
              class="btn outline small"
            >{{ t("page.dashboard.s35") }}</a>
          </div>
          <div
            v-for="task in tasks.slice(0, 5)"
            :key="task.id"
            class="task"
          >
            <div class="task-head">
              <span class="task-topic">{{ task.topic }}</span>
              <span
                v-if="task.status === 'running'"
                class="badge running"
              >
                <el-icon
                  :size="11"
                  class="spin"
                ><Loading /></el-icon> {{ taskStepLabel(task) }}
              </span>
              <span
                v-else-if="task.status === 'failed'"
                class="badge failed"
              >{{ taskStepLabel(task) }}</span>
              <span
                v-else
                class="badge success"
              ><el-icon :size="11"><Check /></el-icon> {{ taskStepLabel(task) }}</span>
            </div>
            <div class="task-bar">
              <div
                class="task-bar-fill"
                :class="{ gradient: task.status === 'running' }"
                :style="{ width: taskProgress(task) + '%' }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head between">
        <h3>{{ t("page.dashboard.s2") }}</h3>
        <a
          href="/chat"
          class="more-link"
        >{{ t("page.dashboard.s36") }} →</a>
      </div>
      <div class="card-body recent">
        <template v-if="loading">
          <div
            class="sk"
            style="height: 48px; margin-bottom: 8px"
          />
          <div
            class="sk"
            style="height: 48px; margin-bottom: 8px"
          />
          <div
            class="sk"
            style="height: 48px"
          />
        </template>
        <div
          v-else-if="recentQA.length === 0"
          class="empty"
        >
          <p>{{ t("page.dashboard.s3") }}</p>
          <a
            href="/chat"
            class="btn outline small"
          >{{ t("page.dashboard.s28") }}</a>
        </div>
        <a
          v-for="qa in recentQA"
          :key="qa.id"
          :href="`/chat?conv=${qa.id}&kb=${qa.kbId}`"
          class="recent-row"
        >
          <span class="recent-avatar">{{ (user?.name ?? "U").charAt(0) }}</span>
          <span class="recent-main">
            <span class="recent-q">{{ qa.q }}</span>
            <span class="recent-meta">
              <span class="badge outline">{{ qa.kb }}</span>
              <span>{{ qa.time }}</span>
            </span>
          </span>
          <span class="recent-arrow">→</span>
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.welcome {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (min-width: 640px) {
  .welcome {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
.welcome h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.sub {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.welcome-actions {
  display: flex;
  gap: 8px;
}
.btn {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.btn.small {
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
}
.btn.outline {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
}
.btn.primary {
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
  overflow: hidden;
}
.card-head {
  padding: 16px 20px 0;
}
.card-head.between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.card-body {
  padding: 12px 20px 20px;
}
.more-link {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
  white-space: nowrap;
}
.more-link:hover {
  color: hsl(var(--foreground));
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (min-width: 1024px) {
  .stats {
    grid-template-columns: repeat(4, 1fr);
  }
}
.stat {
  padding: 18px 20px;
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.stat-icon {
  display: inline-flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.stat-trend.up {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--success));
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 8px;
  overflow: hidden;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge.success {
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.badge.failed {
  background: hsl(var(--destructive) / 0.12);
  color: hsl(var(--destructive));
}
.badge.running {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}
.badge.outline {
  border: 1px solid hsl(var(--border));
  background: none;
  padding: 0 6px;
  font-size: 10px;
}
.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 14px;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.stat-sub {
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.stat-label {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.grid3 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
@media (min-width: 1024px) {
  .grid3 {
    grid-template-columns: repeat(3, 1fr);
  }
  .span2 {
    grid-column: span 2;
  }
  .span3 {
    grid-column: span 3;
  }
}
.chart-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.chart-dot::before {
  content: "";
  display: inline-block;
  height: 8px;
  width: 8px;
  margin-right: 6px;
  border-radius: 9999px;
  background: hsl(var(--primary));
}
.task {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
  border-radius: 12px;
}
.task:last-child {
  margin-bottom: 0;
}
.task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task-topic {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.task-bar {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 9999px;
  background: hsl(var(--secondary));
}
.task-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: hsl(var(--success));
}
.task-bar-fill.gradient {
  background: linear-gradient(90deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
}
.recent {
  display: grid;
  gap: 0;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid hsl(var(--border));
  text-decoration: none;
  color: inherit;
}
.recent-row:last-child {
  border-bottom: 0;
}
.recent-row:hover {
  background: hsl(var(--accent) / 0.4);
}
.recent-avatar {
  display: flex;
  height: 32px;
  width: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-size: 13px;
  font-weight: 600;
}
.recent-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.recent-q {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.recent-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.recent-arrow {
  color: hsl(var(--muted-foreground));
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  margin: 0;
}
.sk {
  display: inline-block;
  border-radius: 8px;
  background: hsl(var(--muted));
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
