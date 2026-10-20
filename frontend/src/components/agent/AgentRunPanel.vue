<script setup lang="ts">
// 运行反馈：错误条 + DAG 工作流 + 步骤时间线。
import { useTranslation } from "i18next-vue";
import {
  ArrowRight, Check, DataAnalysis, EditPen, List, Loading, MagicStick, Search, WarningFilled,
} from "@element-plus/icons-vue";
import type { AgentStep, DagEdge, DagNode } from "@shared/agent/types";

const props = defineProps<{
  show: boolean;
  runError: string | null;
  running: boolean;
  parallelExecuted: boolean;
  branchTriggered: boolean;
  steps: AgentStep[];
  dagNodes: DagNode[];
  dagEdges: DagEdge[];
}>();

const { t } = useTranslation();
const ROLE_ICON: Record<string, object> = {
  planner: List,
  searcher: Search,
  analyzer: DataAnalysis,
  writer: EditPen,
};
</script>

<template>
  <div
    v-if="props.runError"
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
        {{ props.runError }}
      </p>
    </div>
  </div>

  <div
    v-if="props.show"
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
        v-if="props.parallelExecuted"
        class="chip"
      >
        <el-icon :size="10">
          <MagicStick />
        </el-icon>
        {{ t("page.agent.s66") }}
      </span>
      <span
        v-if="props.branchTriggered"
        class="chip"
      >
        <el-icon :size="10">
          <ArrowRight />
        </el-icon>
        {{ t("page.agent.s67") }}
      </span>
      <span
        v-if="props.running"
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
        v-for="(node, i) in props.dagNodes"
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
          v-if="i < props.dagNodes.length - 1 && props.dagEdges.some((e) => e.from === node.id)"
          class="dag-edge"
          :class="{ conditional: props.dagEdges.find((e) => e.from === node.id)?.conditional }"
        >{{ props.dagEdges.find((e) => e.from === node.id)?.conditional ? "?" : "→" }}</span>
      </template>
    </div>
    <!-- 时间线 -->
    <div class="timeline">
      <div
        v-for="(step, i) in props.steps"
        :key="step.role"
        class="tl-item"
      >
        <span
          v-if="i < props.steps.length - 1"
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
</template>
