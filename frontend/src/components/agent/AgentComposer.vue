<script setup lang="ts">
// Agent 调研表单：主题、知识库、输出格式、深度、模板与 Agent 组合。
// 样式在 @/styles/agent-view.css（全局命名空间 .agent-page）。
import { useTranslation } from "i18next-vue";
import {
  Check, DataAnalysis, EditPen, List, Search, VideoPause, VideoPlay,
} from "@element-plus/icons-vue";
import { TEMPLATES, type TemplateId } from "@shared/agent/templates";
import type { OutputFormat } from "@shared/agent/types";
import { ROLE_ORDER, roleLabel, type TFunc } from "@/lib/agent-dag";

interface KbLite {
  id: string;
  name: string;
}

const props = defineProps<{
  topic: string;
  kbId: string;
  kbs: KbLite[];
  format: OutputFormat;
  depth: number;
  template: TemplateId;
  enabledAgents: string[];
  running: boolean;
}>();

const emit = defineEmits<{
  "update:topic": [value: string];
  "update:kbId": [value: string];
  "update:format": [value: OutputFormat];
  "update:depth": [value: number];
  "pick-template": [id: TemplateId];
  "toggle-agent": [role: string];
  run: [];
  stop: [];
}>();

const { t } = useTranslation();
const PUBLIC_SEARCH = "public";

const ROLE_ICON: Record<string, object> = {
  planner: List,
  searcher: Search,
  analyzer: DataAnalysis,
  writer: EditPen,
};

function formatOpts(t2: TFunc): { value: OutputFormat; label: string }[] {
  return [
    { value: "report", label: t2("page.agent.s29") },
    { value: "ppt", label: t2("page.agent.s30") },
    { value: "mindmap", label: t2("page.agent.s31") },
  ];
}

function onKbChange(value: string | number | boolean) {
  emit("update:kbId", String(value));
}

function onDepthChange(value: number | number[]) {
  const next = Array.isArray(value) ? value[0] : value;
  if (typeof next === "number") emit("update:depth", next);
}
</script>

<template>
  <div class="card composer">
    <textarea
      :value="props.topic"
      rows="2"
      class="topic-input"
      :placeholder="t('page.agent.s36')"
      @input="emit('update:topic', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="opts">
      <div class="opt kb-opt">
        <label>{{ t("page.agent.s0") }}</label>
        <el-select
          :model-value="props.kbId"
          size="small"
          :placeholder="t('page.agent.s37')"
          @update:model-value="onKbChange"
        >
          <el-option
            :value="PUBLIC_SEARCH"
            :label="t('page.agent.s1')"
          />
          <el-option
            v-for="kb in props.kbs"
            :key="kb.id"
            :value="kb.id"
            :label="kb.name"
          />
        </el-select>
      </div>
      <div class="opt">
        <label>{{ t("page.agent.s2") }}</label>
        <div class="fmt-group">
          <button
            v-for="f in formatOpts(t)"
            :key="f.value"
            type="button"
            class="fmt"
            :class="{ on: props.format === f.value }"
            @click="emit('update:format', f.value)"
          >
            {{ f.label }}
          </button>
        </div>
      </div>
      <div class="opt depth-opt">
        <label>{{ t("page.agent.s64") }} <span class="depth-val">{{ props.depth }}</span></label>
        <el-slider
          :model-value="props.depth"
          :min="3"
          :max="10"
          :step="1"
          class="depth-slider"
          @update:model-value="onDepthChange"
        />
      </div>
      <el-button
        v-if="props.running"
        type="danger"
        plain
        class="run-btn"
        @click="emit('stop')"
      >
        <el-icon>
          <VideoPause />
        </el-icon>
        {{ t("page.agent.s89") }}
      </el-button>
      <el-button
        v-else
        type="primary"
        class="run-btn"
        :disabled="!props.topic.trim()"
        @click="emit('run')"
      >
        <el-icon>
          <VideoPlay />
        </el-icon>
        {{ t("page.agent.s39") }}
      </el-button>
    </div>
    <div class="opts second">
      <div class="opt">
        <label>{{ t("page.agent.s3") }}</label>
        <div class="tpl-list">
          <button
            v-for="tpl in TEMPLATES"
            :key="tpl.id"
            type="button"
            class="tpl"
            :class="{ on: props.template === tpl.id }"
            :title="tpl.description"
            @click="emit('pick-template', tpl.id)"
          >
            {{ tpl.name }}
          </button>
        </div>
      </div>
      <div class="opt">
        <label>{{ t("page.agent.s4") }}</label>
        <div class="agent-list">
          <button
            v-for="role in ROLE_ORDER"
            :key="role"
            type="button"
            class="agent-toggle"
            :class="{ on: props.enabledAgents.includes(role) }"
            @click="emit('toggle-agent', role)"
          >
            <el-icon :size="11">
              <component :is="ROLE_ICON[role]" />
            </el-icon>
            {{ roleLabel(t, role) }}
            <el-icon
              v-if="props.enabledAgents.includes(role)"
              :size="10"
            >
              <Check />
            </el-icon>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
