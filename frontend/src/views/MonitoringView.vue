<script setup lang="ts">
// 可观测看板（V5，复刻 src/app/(app)/admin/monitoring/page.tsx）：请求 SLI 四卡
// + QPS 分钟级曲线（UsageChart 复用）+ 队列快照表 + LLM 用量/成本按模型表
// + RAG/文档/Agent 三卡 + 追踪列表（展开拉取 span 树）+ 错误环。owner/admin。
// 面板 15s 自动刷新（仅页面可见时；切到后台标签页不再打接口），手动刷新仍可用。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  WarningFilled, MagicStick, Odometer, RefreshRight, Collection,
  Document, ArrowDown, List, Clock,
} from "@element-plus/icons-vue";
import { fetchMonitoring, fetchTrace, type MonitoringData, type TraceSpan } from "@/api/admin";
import UsageChart from "@/components/UsageChart.vue";
import { formatMoney, formatPercent } from "@shared/format";

const { t, i18next } = useTranslation();

const data = ref<MonitoringData | null>(null);
const loading = ref(true);
const expandedTrace = ref<string | null>(null);
const traceSpans = ref<TraceSpan[] | null>(null);

async function refresh() {
  const d = await fetchMonitoring();
  if (d?.requests && d?.llm && d?.queue) data.value = d;
  loading.value = false;
}

/** 自动刷新间隔：监控面板看的是「当下」，手动刷新容易看到过期数据 */
const AUTO_REFRESH_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
const lastRefreshedAt = ref<number>(0);

async function tick() {
  // 后台标签页不刷新：既省接口也不打扰限流
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  await refresh().catch(() => {
    /* 单次失败不打断轮询（下次自动重试） */
  });
  lastRefreshedAt.value = Date.now();
}

onMounted(() => {
  void tick();
  timer = setInterval(() => void tick(), AUTO_REFRESH_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});

async function openTrace(traceId: string) {
  if (expandedTrace.value === traceId) {
    expandedTrace.value = null;
    traceSpans.value = null;
    return;
  }
  expandedTrace.value = traceId;
  traceSpans.value = null;
  try {
    traceSpans.value = await fetchTrace(traceId);
  } catch {
    traceSpans.value = [];
  }
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtUsd(v: number): string {
  return formatMoney(v, i18next.language, "USD");
}

const qpsSeries = computed(() => (data.value?.requests.perMinute ?? []).map((p) => p.count));
const qpsLabels = computed(() =>
  (data.value?.requests.perMinute ?? []).map((p) => {
    const d = new Date(p.ts * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  })
);
const lastMinute = computed(() => {
  const series = data.value?.requests.perMinute ?? [];
  return series[series.length - 1];
});
const llmTotalCost = computed(() => (data.value?.llm.byModel ?? []).reduce((a, m) => a + m.costUsd, 0));

const statCards = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    { label: t("page.monitoring.s4"), value: String(lastMinute.value?.count ?? 0), sub: t("page.monitoring.s36") },
    { label: t("page.monitoring.s5"), value: String(d.requests.total), sub: t("page.monitoring.s42") },
    { label: t("page.monitoring.s6"), value: formatPercent(d.requests.errorRate), sub: `${d.requests.errors} errors` },
    {
      label: t("page.monitoring.s7"),
      value: fmtMs(d.requests.latency.p50),
      sub: `${t("page.monitoring.s8")} ${fmtMs(d.requests.latency.p95)} · ${t("page.monitoring.s9")} ${fmtMs(d.requests.latency.p99)}`,
    },
  ];
});

function kindCls(kind: string): string {
  return (
    {
      api: "k-api",
      rag: "k-rag",
      llm: "k-llm",
      doc: "k-doc",
      agent: "k-agent",
    }[kind] ?? "k-other"
  );
}
</script>

<template>
  <div class="mon-page">
    <template v-if="loading || !data">
      <div class="sk" />
      <div class="sk tall" />
      <div class="sk taller" />
    </template>

    <template v-else>
      <div class="head">
        <div>
          <h1>{{ t("page.monitoring.s0") }}</h1>
          <p class="sub">
            {{ t("page.monitoring.s1") }} · {{ t("page.monitoring.s3") }} {{ fmtUptime(data.uptimeMs) }}
          </p>
        </div>
        <el-button
          :icon="RefreshRight"
          @click="refresh"
        >
          {{ t("page.monitoring.s2") }}
        </el-button>
      </div>

      <!-- SLI 卡 -->
      <div class="cards">
        <div
          v-for="c in statCards"
          :key="c.label"
          class="stat"
        >
          <div class="stat-label">
            {{ c.label }}
          </div>
          <p class="stat-value">
            {{ c.value }}
          </p>
          <p class="stat-sub">
            {{ c.sub }}
          </p>
        </div>
      </div>

      <!-- QPS -->
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">
            {{ t("page.monitoring.s10") }}
          </h3>
          <span class="badge muted">{{ t("page.monitoring.s43") }}</span>
        </div>
        <UsageChart
          :data="qpsSeries.length >= 2 ? qpsSeries : [0, 0]"
          :labels="qpsLabels"
        />
      </div>

      <!-- 队列 -->
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <Collection />
            </el-icon>
            {{ t("page.monitoring.s44") }}
          </h3>
          <span
            class="badge"
            :class="data.queue.available ? 'muted' : 'bad'"
          >{{ data.queue.mode === "redis" ? t("page.monitoring.s46") : t("page.monitoring.s45") }}</span>
        </div>
        <p
          v-if="!data.queue.available"
          class="empty-hint"
        >
          {{ t("page.monitoring.s54") }}
        </p>
        <p
          v-else-if="data.queue.queues.length === 0"
          class="empty-hint"
        >
          {{ t("page.monitoring.s28") }}
        </p>
        <div
          v-else
          class="tbl-wrap"
        >
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ t("page.monitoring.s47") }}</th>
                <th>{{ t("page.monitoring.s48") }}</th>
                <th>{{ t("page.monitoring.s49") }}</th>
                <th>{{ t("page.monitoring.s50") }}</th>
                <th>{{ t("page.monitoring.s51") }}</th>
                <th>{{ t("page.monitoring.s52") }}</th>
                <th>{{ t("page.monitoring.s53") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="q in data.queue.queues"
                :key="q.name"
              >
                <td class="mono-cell">
                  {{ q.name }}
                </td>
                <td class="num">
                  {{ q.concurrency }}
                </td>
                <td class="num">
                  {{ q.counts.waiting }}
                </td>
                <td class="num">
                  {{ q.counts.active }}
                </td>
                <td class="num">
                  {{ q.counts.delayed }}
                </td>
                <td class="num ok-text">
                  {{ q.counts.completed }}
                </td>
                <td class="num err-text">
                  {{ q.counts.failed }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- LLM -->
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <MagicStick />
            </el-icon>
            {{ t("page.monitoring.s11") }}
          </h3>
          <div class="llm-sum">
            <span>{{ t("page.monitoring.s17") }}: <b class="num">{{ data.llm.totalTokens.toLocaleString() }}</b></span>
            <span>{{ t("page.monitoring.s18") }}: <b class="num">{{ fmtUsd(data.llm.costUsd) }}</b></span>
            <span>{{ t("page.monitoring.s16") }}: <b class="num">{{ fmtMs(data.llm.latency.avgMs) }}</b></span>
          </div>
        </div>
        <p
          v-if="data.llm.byModel.length === 0"
          class="empty-hint"
        >
          {{ t("page.monitoring.s28") }}
        </p>
        <div
          v-else
          class="tbl-wrap"
        >
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ t("page.monitoring.s12") }}</th>
                <th>{{ t("page.monitoring.s13") }}</th>
                <th>{{ t("page.monitoring.s14") }}</th>
                <th>{{ t("page.monitoring.s15") }}</th>
                <th>{{ t("page.monitoring.s16") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in data.llm.byModel"
                :key="m.model"
              >
                <td class="mono-cell">
                  {{ m.model }}<span
                    v-if="m.errors > 0"
                    class="err-text"
                  >({{ m.errors }} err)</span>
                </td>
                <td class="num">
                  {{ m.calls }}
                </td>
                <td class="num">
                  {{ m.tokens.toLocaleString() }}
                </td>
                <td class="num">
                  {{ fmtUsd(m.costUsd) }}
                </td>
                <td class="num">
                  {{ fmtMs(m.avgMs) }}
                </td>
              </tr>
              <tr class="total-row">
                <td>{{ t("page.monitoring.s18") }}</td>
                <td class="num">
                  {{ data.llm.calls }}
                </td>
                <td class="num">
                  {{ data.llm.totalTokens.toLocaleString() }}
                </td>
                <td class="num">
                  {{ fmtUsd(llmTotalCost) }}
                </td>
                <td class="num">
                  {{ fmtMs(data.llm.latency.avgMs) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- RAG / 文档 / Agent -->
      <div class="trio">
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <Odometer />
            </el-icon>
            {{ t("page.monitoring.s19") }}
          </h3>
          <p class="kv">
            <span>{{ t("page.monitoring.s22") }}</span><span class="num">{{ data.rag.calls }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s16") }}</span><span class="num">{{ fmtMs(data.rag.latency.avgMs) }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s8") }}</span><span class="num">{{ fmtMs(data.rag.latency.p95) }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s24") }}</span><span class="num err-text">{{ data.rag.errors }}</span>
          </p>
        </div>
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <Document />
            </el-icon>
            {{ t("page.monitoring.s20") }}
          </h3>
          <p class="kv">
            <span>{{ t("page.monitoring.s22") }}</span><span class="num">{{ data.doc.calls }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s23") }}</span><span class="num">{{ fmtMs(data.doc.avgMs) }}</span>
          </p>
          <p class="kv">
            <span>OK</span><span class="num ok-text">{{ data.doc.ok }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s24") }}</span><span class="num err-text">{{ data.doc.failed }}</span>
          </p>
        </div>
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <MagicStick />
            </el-icon>
            {{ t("page.monitoring.s21") }}
          </h3>
          <p class="kv">
            <span>{{ t("page.monitoring.s22") }}</span><span class="num">{{ data.agent.runs }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s23") }}</span><span class="num">{{ fmtMs(data.agent.avgMs) }}</span>
          </p>
          <p class="kv">
            <span>OK</span><span class="num ok-text">{{ data.agent.ok }}</span>
          </p>
          <p class="kv">
            <span>{{ t("page.monitoring.s24") }}</span><span class="num err-text">{{ data.agent.failed }}</span>
          </p>
        </div>
      </div>

      <!-- 追踪 -->
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <List />
            </el-icon>
            {{ t("page.monitoring.s25") }}
          </h3>
          <span class="muted-cell">{{ t("page.monitoring.s26") }}</span>
        </div>
        <p
          v-if="data.traces.length === 0"
          class="empty-hint"
        >
          {{ t("page.monitoring.s40") }}
        </p>
        <div
          v-else
          class="traces"
        >
          <div
            v-for="tr in data.traces"
            :key="tr.traceId"
            class="trace"
          >
            <button
              type="button"
              class="trace-row"
              @click="openTrace(tr.traceId)"
            >
              <span
                class="badge"
                :class="tr.status === 'ok' ? 'ok' : 'bad'"
              >{{ tr.status === "ok" ? "OK" : "ERR" }}</span>
              <span class="trace-name">{{ tr.name }}</span>
              <span class="trace-time">{{ new Date(tr.start).toLocaleTimeString() }}</span>
              <span class="trace-dur">{{ fmtMs(tr.durationMs) }}</span>
              <el-icon
                :size="14"
                class="chev"
                :class="{ open: expandedTrace === tr.traceId }"
              >
                <ArrowDown />
              </el-icon>
            </button>
            <div
              v-if="expandedTrace === tr.traceId"
              class="spans"
            >
              <p class="trace-id">
                {{ t("page.monitoring.s39") }}: {{ tr.traceId }}
              </p>
              <div
                v-if="traceSpans === null"
                class="sk span-sk"
              />
              <p
                v-else-if="traceSpans.length === 0"
                class="empty-hint"
              >
                {{ t("page.monitoring.s28") }}
              </p>
              <ul
                v-else
                class="span-list"
              >
                <li
                  v-for="sp in traceSpans"
                  :key="sp.spanId"
                  class="span-row"
                >
                  <span
                    class="kind"
                    :class="kindCls(sp.kind)"
                  >{{ sp.kind }}</span>
                  <span class="span-name">{{ sp.name }}</span>
                  <span
                    v-if="sp.status !== 'ok'"
                    class="err-text"
                  >ERR</span>
                  <span class="span-dur">{{ fmtMs(sp.durationMs) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- 错误环 -->
      <div class="card">
        <h3 class="card-title">
          <el-icon
            :size="14"
            class="title-ico"
          >
            <WarningFilled />
          </el-icon>
          {{ t("page.monitoring.s27") }}
        </h3>
        <p
          v-if="data.errors.length === 0"
          class="empty-hint"
        >
          {{ t("page.monitoring.s41") }}
        </p>
        <div
          v-else
          class="err-list"
        >
          <div
            v-for="e in data.errors"
            :key="e.id"
            class="err-item"
          >
            <el-icon
              :size="13"
              class="err-ico"
            >
              <WarningFilled />
            </el-icon>
            <div class="err-body">
              <p class="err-msg">
                {{ e.message }}
              </p>
              <p class="err-meta">
                {{ e.source }} · <el-icon
                  :size="9"
                  style="vertical-align: -1px"
                >
                  <Clock />
                </el-icon> {{ new Date(e.createdAt).toLocaleTimeString() }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mon-page {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sub { font-size: 13px; }

.sk { height: 64px; border-radius: var(--radius-lg); }

.sk.tall {
  height: 256px;
}
.sk.taller {
  height: 320px;
}
.sk.span-sk {
  height: 64px;
  border-radius: var(--radius-sm);
}

.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (min-width: 1024px) {
  .cards {
    grid-template-columns: repeat(4, 1fr);
  }
}
.stat {
  padding: 20px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background: hsl(var(--card));
}
.stat-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.stat-value {
  margin: 8px 0 0;
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.card { padding: 20px; border-radius: var(--radius-lg); }

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.title-ico {
  color: hsl(var(--primary));
}
.badge { justify-content: center; font-weight: 500; }

.badge.ok { background: hsl(var(--positive) / 0.12); color: hsl(var(--positive-text)); }
.badge.bad { background: hsl(var(--destructive) / 0.12); color: hsl(var(--destructive)); }
.badge.muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.tbl-wrap {
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  padding: 6px 8px;
  border-bottom: 1px solid hsl(var(--border));
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.tbl td {
  padding: 8px;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
}
.tbl tbody tr:last-child td {
  border-bottom: 0;
}
.num {
  font-variant-numeric: tabular-nums;
}
.mono-cell {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.ok-text { color: hsl(var(--positive-text)); }
.err-text { color: hsl(var(--destructive)); }
.total-row {
  font-weight: 600;
}
.total-row td {
  padding-top: 12px;
}
.llm-sum {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.trio {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 1024px) {
  .trio {
    grid-template-columns: repeat(3, 1fr);
  }
}
.kv {
  display: flex;
  justify-content: space-between;
  margin: 4px 0;
  font-size: 13px;
}
.kv span:first-child {
  color: hsl(var(--muted-foreground));
}
.traces {
  display: grid;
  gap: 4px;
}
.trace {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-sm);
}
.trace-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.trace-row:hover {
  background: hsl(var(--accent) / 0.4);
}
.trace-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.trace-time {
  flex-shrink: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.trace-dur {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--muted-foreground));
}
.chev {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}
.spans {
  padding: 8px 12px;
  border-top: 1px solid hsl(var(--border));
}
.trace-id {
  margin: 0 0 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.span-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
}
.span-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.span-row:hover {
  background: hsl(var(--accent) / 0.4);
}
.kind {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
}
.k-api { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); }
.k-rag { background: hsl(var(--tint-sky) / 0.1); color: hsl(var(--tint-sky)); }
.k-llm { background: hsl(var(--tint-violet) / 0.1); color: hsl(var(--tint-violet)); }
.k-doc { background: hsl(var(--tint-emerald) / 0.1); color: hsl(var(--tint-emerald)); }
.k-agent { background: hsl(var(--warning-bright) / 0.1); color: hsl(var(--warning-bright)); }
.k-other { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.span-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
}
.span-dur {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--muted-foreground));
}
.err-list {
  display: grid;
  gap: 4px;
}
.err-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.6);
  border-radius: var(--radius-sm);
}
.err-ico {
  flex-shrink: 0;
  margin-top: 2px;
  color: hsl(var(--destructive));
}
.err-msg {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.err-meta {
  margin: 0;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.empty-hint {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.muted-cell {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
</style>
