<script setup lang="ts">
// 用量计量（V4，复刻 src/app/(app)/usage/page.tsx）：workspace 级四张用量卡
// （问答/API 调用/存储/Agent，额度按套餐动态派生，>80% 警告）+ 每用户
// QA 趋势图（UsageChart 复用）。加载失败可重试。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { ChatLineRound, Key, Box, MagicStick, TrendCharts, RefreshRight } from "@element-plus/icons-vue";
import { formatNumber, formatSize } from "@shared/format";
import { fetchUsage, type WorkspaceUsage } from "@/api/billing";
import UsageChart from "@/components/UsageChart.vue";

const { t } = useTranslation();

const data = ref<WorkspaceUsage | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    data.value = await fetchUsage();
  } catch {
    /* data 保持 null → 失败态（重试不清已加载数据） */
  }
  loading.value = false;
}

onMounted(() => void load());

const planBadge = computed(() => {
  const p = data.value?.plan;
  return p === "pro" ? t("page.usage.planPro") : p === "enterprise" ? t("page.usage.planEnt") : t("page.usage.planFree");
});

interface Meter {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  fmt?: boolean;
  tint: string;
}

const meters = computed<Meter[]>(() => [
  { label: t("page.usage.meterQa"), used: data.value?.usage.qaUsed ?? 0, limit: data.value?.usage.qaLimit ?? null, unit: t("page.usage.unitTimes"), tint: "qa" },
  { label: t("page.usage.meterApi"), used: data.value?.userUsage?.apiCalls ?? 0, limit: null, unit: t("page.usage.unitTimes"), tint: "api" },
  { label: t("page.usage.meterStorage"), used: data.value?.usage.storageUsed ?? 0, limit: data.value?.usage.storageLimit ?? null, unit: "", fmt: true, tint: "storage" },
  { label: t("page.usage.meterAgent"), used: data.value?.usage.agentTasks ?? 0, limit: data.value?.usage.agentLimit ?? null, unit: t("page.usage.unitTimes"), tint: "agent" },
]);

const trend = computed(() => data.value?.userUsage?.trend ?? []);
const trendData = computed(() => trend.value.map((p) => p.qa));
const trendLabels = computed(() => trend.value.map((p) => p.date));

function usedStr(m: Meter): string {
  return m.fmt ? formatSize(m.used) : formatNumber(m.used);
}
function limitStr(m: Meter): string {
  if (m.limit === null) return t("page.usage.limitInfinite");
  return m.fmt ? formatSize(m.limit) : formatNumber(m.limit);
}
function pct(m: Meter): number {
  return m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
}
</script>

<template>
  <div class="usage-page">
    <!-- 加载态 -->
    <template v-if="loading">
      <el-skeleton
        class="sk"
        animated
      >
        <template #template>
          <el-skeleton-item
            variant="rect"
            style="height: 96px; border-radius: var(--radius-lg)"
          />
          <div class="sk-grid">
            <el-skeleton-item
              v-for="i in 4"
              :key="i"
              variant="rect"
              style="height: 112px; border-radius: var(--radius)"
            />
          </div>
          <el-skeleton-item
            variant="rect"
            style="height: 288px; border-radius: var(--radius-lg)"
          />
        </template>
      </el-skeleton>
    </template>

    <!-- 失败态 -->
    <div
      v-else-if="!data"
      class="fail"
    >
      <p>{{ t("page.app-shell.s4") }}</p>
      <el-button
        :icon="RefreshRight"
        @click="load"
      >
        {{ t("common.retry") }}
      </el-button>
    </div>

    <template v-else>
      <div class="head">
        <div>
          <h2>{{ t("page.usage.title") }}</h2>
          <p class="sub">
            {{ t("page.usage.subtitle") }}
          </p>
        </div>
        <span class="plan-badge">{{ planBadge }}</span>
      </div>

      <!-- 用量卡 -->
      <div class="cards">
        <div
          v-for="(m, i) in meters"
          :key="m.label"
          class="meter"
        >
          <div class="meter-top">
            <span
              class="meter-ava"
              :class="['qa', 'api', 'storage', 'agent'][i]"
            >
              <el-icon :size="16">
                <component :is="[ChatLineRound, Key, Box, MagicStick][i]" />
              </el-icon>
            </span>
            <span
              v-if="m.limit !== null && pct(m) > 80"
              class="warn-badge"
            >{{ t("page.usage.nearLimit") }}</span>
          </div>
          <div class="meter-val">
            <span class="used">{{ usedStr(m) }}</span>
            <span class="limit">/ {{ limitStr(m) }}{{ m.unit && m.limit !== null ? ` ${m.unit}` : "" }}</span>
          </div>
          <p class="meter-label">
            {{ m.label }}
          </p>
          <el-progress
            v-if="m.limit !== null"
            :percentage="pct(m)"
            :show-text="false"
            :stroke-width="6"
            :color="pct(m) > 80 ? '#f59e0b' : undefined"
            class="meter-bar"
          />
        </div>
      </div>

      <!-- 趋势 -->
      <div class="card">
        <div class="trend-head">
          <h3 class="trend-title">
            <el-icon
              :size="14"
              class="trend-ico"
            >
              <TrendCharts />
            </el-icon>
            {{ t("page.usage.s0") }}
          </h3>
          <div class="trend-right">
            <span class="legend">
              <span class="legend-dot" /> {{ t("page.usage.s1") }}
            </span>
            <span class="days-badge">{{ t("page.usage.last14Days") }}</span>
          </div>
        </div>
        <UsageChart
          :data="trendData"
          :labels="trendLabels"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.usage-page {
  max-width: 64rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.sk-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 16px 0;
}
@media (min-width: 1024px) {
  .sk-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
.fail {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 64px 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.fail p {
  margin: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sub { font-size: 13px; }

.plan-badge {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: hsl(var(--primary) / 0.1);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
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
.meter {
  padding: 20px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background: hsl(var(--card));
}
.meter-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.meter-ava {
  display: flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: hsl(var(--muted));
}
.meter-ava.qa {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
}
.meter-ava.api {
  color: #10b981;
  background: rgb(16 185 129 / 0.1);
}
.meter-ava.storage {
  color: #f59e0b;
  background: rgb(245 158 11 / 0.1);
}
.meter-ava.agent {
  color: #8b5cf6;
  background: rgb(139 92 246 / 0.1);
}
.warn-badge {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: #f59e0b22;
  font-size: 10px;
  color: #b45309;
}
.meter-val {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 16px;
}
.used {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.limit {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.meter-label {
  margin: 4px 0 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.meter-bar {
  margin-top: 12px;
}
.card { padding: 20px; border-radius: var(--radius-lg); }

.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.trend-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.trend-ico {
  color: hsl(var(--primary));
}
.trend-right {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: hsl(var(--muted-foreground));
}
.legend-dot {
  height: 8px;
  width: 8px;
  border-radius: var(--radius-full);
  background: hsl(var(--primary));
}
.days-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
