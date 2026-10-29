<script setup lang="ts">
// 服务可用性徽标条（V5，复刻 src/components/marketing/live-status.tsx）：
// 轮询 /api/health/ready（30s），toReadinessPulse（@shared/marketing/readiness
// 单源）归一化状态；compact 模式只显示总状态，完整模式带 db/redis/llm 三卡。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { TrendCharts, Collection, MagicStick, Promotion } from "@element-plus/icons-vue";
import { toReadinessPulse, type ReadinessPulse } from "@shared/marketing/readiness";

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const { t } = useTranslation();

const pulse = ref<ReadinessPulse>({ state: "offline", checks: [] });
const loading = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    const res = await fetch("/api/health/ready", { cache: "no-store" });
    pulse.value = toReadinessPulse(await res.json());
  } catch {
    pulse.value = toReadinessPulse(null);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const state = computed(() => (loading.value ? "checking" : pulse.value.state));
const label = computed(() =>
  state.value === "online" ? t("page.hero.s28")
  : state.value === "degraded" ? t("page.hero.s29")
  : state.value === "offline" ? t("page.hero.s30")
  : t("page.hero.s27")
);

const CHECKS = [
  { name: "db" as const, icon: Collection },
  { name: "redis" as const, icon: Promotion },
  { name: "llm" as const, icon: MagicStick },
];

function checkOf(name: "db" | "redis" | "llm") {
  return pulse.value.checks.find((item) => item.name === name);
}

function checkText(name: "db" | "redis" | "llm"): string {
  const check = checkOf(name);
  if (check?.status === "degraded") return t("page.hero.s29");
  if (typeof check?.latencyMs === "number") return `${check.latencyMs} ms`;
  return check?.status === "ok" ? t("page.hero.s33") : t("page.hero.s27");
}
</script>

<template>
  <div
    class="live"
    :class="{ compact: props.compact }"
  >
    <div class="live-line" />
    <div class="live-row">
      <span class="live-ava">
        <el-icon :size="15">
          <TrendCharts />
        </el-icon>
      </span>
      <div class="live-main">
        <div class="live-label">
          {{ t("page.hero.s26") }}
        </div>
        <div class="live-state">
          <span
            class="pdot"
            :class="state"
          >
            <span
              v-if="state === 'online'"
              class="pdot-ring"
            />
          </span>
          {{ label }}
        </div>
      </div>
      <div
        v-if="!props.compact"
        class="live-checks"
      >
        <div
          v-for="c in CHECKS"
          :key="c.name"
          class="check"
        >
          <div class="check-name">
            <el-icon :size="11">
              <component :is="c.icon" />
            </el-icon>
            {{ c.name }}
          </div>
          <div class="check-val">
            {{ checkText(c.name) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.live {
  position: relative;
  overflow: hidden;
  padding: 16px 20px;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: var(--radius-lg);
  background: hsl(var(--card) / 0.75);
  backdrop-filter: blur(16px);
}
/* compact 即 hero 服务状态条的最终形态（唯一消费方是 MktHero）：裸条——
   无内边距 / 无描边 / 透明底 / 无毛玻璃，顶部渐变线隐藏，尺寸整体收紧。
   这些覆盖此前写在父组件的 :deep() 里，现收敛进组件自身。 */
.live.compact {
  padding: 0;
  border: 0;
  background: transparent;
  backdrop-filter: none;
}
.live.compact .live-line {
  display: none;
}
.live.compact .live-row {
  justify-content: center;
}
.live.compact .live-ava {
  width: 28px;
  height: 28px;
  border-radius: 9px;
}
.live.compact .live-label {
  font-size: 9px;
  letter-spacing: 0.12em;
}
.live.compact .live-state {
  font-size: 12px;
}
.live-line {
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.7), transparent);
}
.live-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.live-ava {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--primary) / 0.2);
  border-radius: var(--radius);
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.live-main {
  min-width: 0;
}
.live-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
.live-state {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.pdot {
  position: relative;
  display: inline-flex;
  height: 8px;
  width: 8px;
  border-radius: var(--radius-full);
}
.pdot.online { background: hsl(var(--positive)); }
.pdot.degraded { background: hsl(var(--warning-bright)); }
.pdot.offline { background: hsl(var(--destructive)); }
.pdot.checking { background: hsl(var(--muted-foreground)); }
.pdot-ring {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  background: hsl(var(--positive) / 0.6);
  animation: ping 1.5s var(--ease-out-quad) infinite;
}

.live-checks {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-left: auto;
}
.check {
  min-width: 80px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--background) / 0.6);
}
.check-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
.check-val {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
}

/* 宽屏下 hero 里的状态条左对齐（原由 MktHero 的 :deep() 覆盖） */
@media (min-width: 1180px) {
  .live.compact .live-row {
    justify-content: flex-start;
  }
}
</style>
