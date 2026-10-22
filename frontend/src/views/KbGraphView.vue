<script setup lang="ts">
// 知识图谱（V3，复刻 knowledge-base/[id]/graph + KnowledgeGraph）：
// computeGraphLayout（@shared，d3-force 同步 tick(300)，坐标 SSR/客户端一致）
// + SVG 渲染（节点按类型着色、边粗细按权重、点击选中高亮邻居）+ 搜索高亮。
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Connection } from "@element-plus/icons-vue";
import { fetchGraph, type GraphEdge, type GraphNode } from "@/api/kb";
import { ApiError } from "@/api/client";
import { computeGraphLayout, type LayoutNode } from "@shared/kg/layout";

const { t } = useTranslation();
const route = useRoute();
const kbId = String(route.params.id ?? "");

const kbName = ref("");
const loading = ref(true);
const error = ref<string | null>(null);
const nodes = ref<GraphNode[]>([]);
const edges = ref<GraphEdge[]>([]);
const selected = ref<string | null>(null);
const query = ref("");

onMounted(async () => {
  try {
    const d = await fetchGraph(kbId);
    kbName.value = d.kb?.name ?? "";
    nodes.value = d.nodes ?? [];
    edges.value = d.edges ?? [];
  } catch (e) {
    error.value = e instanceof ApiError && e.message ? e.message : t("common.requestFailed");
  } finally {
    loading.value = false;
  }
});

const layout = computed(() => {
  const l = computeGraphLayout(nodes.value, edges.value);
  // @shared/kg/layout 输出的边端点是实体 label（API 形状），节点主键是 id
  // （ent_*）——这里统一到 id 空间寻址，否则边坐标与选中高亮恒匹配失败
  //（Next 版同源缺陷：边全部塌在原点、选中节点后邻接边不变色）。
  // label 必有对应节点由 layout 的 labelSet 端点过滤保证。
  const idByLabel = new Map(l.nodes.map((n) => [n.label, n.id]));
  return {
    nodes: l.nodes,
    edges: l.edges.map((e) => ({
      ...e,
      source: idByLabel.get(e.source)!,
      target: idByLabel.get(e.target)!,
    })),
  };
});

const TYPE_COLORS: Record<string, string> = {
  person: "#6366f1",
  org: "#0ea5e9",
  concept: "#10b981",
  event: "#f59e0b",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] ?? "hsl(var(--primary))";
}

// 选中节点的邻居 id 集合（1-hop），用于高亮
const neighborIds = computed(() => {
  if (!selected.value) return null;
  const s = new Set<string>([selected.value]);
  for (const e of layout.value.edges) {
    if (e.source === selected.value) s.add(e.target);
    if (e.target === selected.value) s.add(e.source);
  }
  return s;
});

const q = computed(() => query.value.trim().toLowerCase());
function dimmed(n: LayoutNode): boolean {
  if (q.value) return !n.label.toLowerCase().includes(q.value);
  if (neighborIds.value) return !neighborIds.value.has(n.id);
  return false;
}

function nodeRadius(n: LayoutNode): number {
  return Math.max(6, Math.min(18, 4 + n.mentions));
}

function onClickNode(id: string) {
  selected.value = selected.value === id ? null : id;
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <router-link
          :to="`/knowledge-base/${kbId}`"
          class="back"
        >
          ← {{ t("page.knowledge-graph.s0") }}
        </router-link>
        <h2>{{ kbName }} · {{ t("page.knowledge-graph.s1") }}</h2>
      </div>
      <input
        v-model="query"
        class="search"
        :placeholder="t('page.knowledge-graph.s18')"
        :aria-label="t('page.knowledge-graph.s18')"
      >
    </div>

    <div
      v-if="loading"
      class="sk"
      style="height: 420px"
    />
    <div
      v-else-if="error"
      class="err-box"
    >
      {{ error }}
    </div>
    <div
      v-else-if="nodes.length === 0"
      class="empty"
    >
      <span class="empty-icon">
        <el-icon :size="22"><Connection /></el-icon>
      </span>
      <p class="empty-title">
        {{ t("page.knowledge-graph.s6") }}
      </p>
      <p class="empty-desc">
        {{ t("page.knowledge-graph.s7") }}
      </p>
      <router-link
        :to="`/knowledge-base/${kbId}`"
        class="btn outline small"
      >
        {{ t("page.knowledge-graph.s8") }}
      </router-link>
    </div>

    <div
      v-else
      class="graph-card"
    >
      <div class="legend">
        <span
          v-for="(color, type) in TYPE_COLORS"
          :key="type"
          class="legend-item"
        >
          <span
            class="legend-dot"
            :style="{ background: color }"
          /> {{ type }}
        </span>
      </div>
      <svg
        viewBox="0 0 900 560"
        class="graph-svg"
      >
        <g>
          <line
            v-for="e in layout.edges"
            :key="e.id"
            :x1="(layout.nodes.find((n) => n.id === e.source) as LayoutNode)?.x ?? 0"
            :y1="(layout.nodes.find((n) => n.id === e.source) as LayoutNode)?.y ?? 0"
            :x2="(layout.nodes.find((n) => n.id === e.target) as LayoutNode)?.x ?? 0"
            :y2="(layout.nodes.find((n) => n.id === e.target) as LayoutNode)?.y ?? 0"
            :stroke="selected && (e.source === selected || e.target === selected) ? 'hsl(var(--primary))' : 'hsl(var(--border))'"
            :stroke-width="Math.max(1, Math.min(4, e.weight))"
            :opacity="selected && !(e.source === selected || e.target === selected) ? 0.25 : 0.7"
          />
        </g>
        <g
          v-for="n in layout.nodes"
          :key="n.id"
          class="node"
          @click="onClickNode(n.id)"
        >
          <circle
            :cx="n.x"
            :cy="n.y"
            :r="nodeRadius(n)"
            :fill="nodeColor(n.type)"
            :opacity="dimmed(n) ? 0.25 : 0.9"
            :stroke="selected === n.id ? 'hsl(var(--foreground))' : 'none'"
            stroke-width="2"
          />
          <text
            :x="n.x"
            :y="n.y + nodeRadius(n) + 12"
            text-anchor="middle"
            class="node-label"
            :opacity="dimmed(n) ? 0.3 : 1"
          >
            {{ n.label }}
          </text>
        </g>
      </svg>
      <p class="hint">
        {{ nodes.length }} {{ t("page.knowledge-graph.s3") }} · {{ edges.length }} edges
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 16px;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.back {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}
.back:hover {
  color: hsl(var(--foreground));
}
.head h2 {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 700;
}
.search {
  height: 34px;
  width: 220px;
  padding: 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  font: inherit;
  font-size: 13px;
  color: hsl(var(--foreground));
}
.graph-card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
  padding: 12px;
}
.legend {
  display: flex;
  gap: 16px;
  padding: 4px 8px 10px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  height: 10px;
  width: 10px;
  border-radius: 9999px;
}
.graph-svg {
  width: 100%;
  height: auto;
  background: hsl(var(--background));
  border-radius: 8px;
}
.node {
  cursor: pointer;
}
.node-label {
  font-size: 11px;
  fill: hsl(var(--foreground));
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-align: right;
}
.empty {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 64px 24px;
  border: 1px dashed hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  text-align: center;
}
.empty-icon {
  display: inline-flex;
  height: 46px;
  width: 46px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-size: 20px;
}
.empty-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
}
.empty-desc {
  margin: 0 0 6px;
  max-width: 30rem;
  line-height: 1.6;
}
.err-box {
  padding: 14px 16px;
  border: 1px solid hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.05);
  border-radius: 8px;
  color: hsl(var(--destructive));
  font-size: 14px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  height: 30px;
  border-radius: 8px;
  font-size: 13px;
  text-decoration: none;
}
.btn.outline {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
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
