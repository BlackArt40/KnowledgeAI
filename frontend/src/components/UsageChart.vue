<script setup lang="ts">
// 用量趋势图（纯 SVG 面积图，复刻 UsageChart 视觉：渐变面积 + 主线 + 空态）。
// 空态必须显式展示：早前用固定示例序列兜底，会把「0 次问答」画成一条上升曲线。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";

const props = defineProps<{ data?: number[]; labels?: string[] }>();
const { t } = useTranslation();

const W = 560;
const H = 200;
const PAD = 14;

// 全 0 序列（有 14 天窗口但没有任何用量）也按空态处理，避免贴底的一条直线
const hasData = computed(() => (props.data ?? []).some((v) => v > 0));

function points(): { x: number; y: number; v: number }[] {
  const s = props.data ?? [];
  const max = Math.max(...s, 1);
  return s.map((v, i) => ({
    x: PAD + (i / Math.max(s.length - 1, 1)) * (W - PAD * 2),
    y: H - PAD - (v / max) * (H - PAD * 2),
    v,
  }));
}

const linePath = () =>
  points().map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

const areaPath = () => {
  const pts = points();
  if (pts.length === 0) return "";
  const base = H - PAD;
  return `M${pts[0].x},${base} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${pts[pts.length - 1].x},${base} Z`;
};
</script>

<template>
  <div
    v-if="!hasData"
    class="usage-chart chart-empty"
  >
    <span class="empty-dot" />
    <span class="empty-text">{{ t("page.usage-chart.s7") }}</span>
  </div>
  <svg
    v-else
    :viewBox="`0 0 ${W} ${H}`"
    class="usage-chart"
    preserveAspectRatio="none"
    role="img"
  >
    <defs>
      <linearGradient
        id="usage-grad"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0%"
          stop-color="hsl(var(--primary))"
          stop-opacity="0.25"
        />
        <stop
          offset="100%"
          stop-color="hsl(var(--primary))"
          stop-opacity="0.02"
        />
      </linearGradient>
    </defs>
    <line
      :x1="0"
      :y1="H - PAD + 1"
      :x2="W"
      :y2="H - PAD + 1"
      stroke="hsl(var(--border))"
      stroke-width="1"
      stroke-dasharray="4 6"
    />
    <path
      :d="areaPath()"
      fill="url(#usage-grad)"
    />
    <path
      :d="linePath()"
      fill="none"
      stroke="hsl(var(--primary))"
      stroke-width="2"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.usage-chart {
  width: 100%;
  height: 220px;
  display: block;
}
.chart-empty {
  display: flex;
  height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: var(--radius);
  background:
    linear-gradient(hsl(var(--muted) / 0.45), hsl(var(--muted) / 0.12));
  color: hsl(var(--muted-foreground));
}
.empty-dot {
  height: 10px;
  width: 10px;
  border-radius: var(--radius-full);
  background: hsl(var(--primary) / 0.35);
  box-shadow: 0 0 0 6px hsl(var(--primary) / 0.08);
}
.empty-text {
  font-size: 13px;
}
</style>
