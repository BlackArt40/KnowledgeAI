<script setup lang="ts">
// 侧列：历史任务 + 引用来源 + 本次耗时。
import { useTranslation } from "i18next-vue";
import { ArrowRight, Clock, Document, Search } from "@element-plus/icons-vue";
import type { AgentTask } from "@shared/agent/types";

const props = defineProps<{
  history: AgentTask[];
  activeTaskId: string | null;
  citations: AgentTask["citations"];
  highlightN: number | null;
  durationText: string | null;
}>();

const emit = defineEmits<{ select: [id: string] }>();
const { t } = useTranslation();
</script>

<template>
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
      v-if="props.history.length === 0"
      class="empty-hint"
    >
      {{ t("page.agent.s9") }}
    </p>
    <div
      v-else
      class="history"
    >
      <button
        v-for="h in props.history"
        :key="h.id"
        type="button"
        class="history-item"
        :class="{ active: props.activeTaskId === h.id }"
        @click="emit('select', h.id)"
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
        v-if="props.citations.length > 0"
        class="chip"
      >{{ props.citations.length }}</span>
    </h3>
    <p
      v-if="props.citations.length === 0"
      class="empty-hint"
    >
      {{ t("page.agent.s10") }}
    </p>
    <div
      v-else
      class="cites"
    >
      <div
        v-for="c in props.citations"
        :key="c.n"
        class="cite"
        :class="{ active: props.highlightN === c.n }"
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
    v-if="props.durationText"
    class="duration"
  >
    <el-icon :size="12">
      <Clock />
    </el-icon>
    {{ props.durationText }}
  </div>
</template>
