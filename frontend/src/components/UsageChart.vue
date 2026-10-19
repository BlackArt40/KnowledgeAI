<script setup lang="ts">
// 用量趋势图（纯 SVG 面积图，复刻 UsageChart 视觉：渐变面积 + 主线 + 空态）。
const props = defineProps<{ data?: number[]; labels?: string[] }>();

const W = 560;
const H = 200;
const PAD = 8;

const series = () => (props.data && props.data.length > 0 ? props.data : [2, 5, 3, 8, 6, 10, 7, 12, 9, 14, 11, 16, 13, 15]);

function points(): { x: number; y: number; v: number }[] {
  const s = series();
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
  <svg
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
</style>
