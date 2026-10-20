<script setup lang="ts">
// 报告公开分享设置：链接、有效期、密码、访问次数。
import { useTranslation } from "i18next-vue";
import { Check, CopyDocument } from "@element-plus/icons-vue";
import type { ShareConfig } from "@shared/agent/types";

const props = defineProps<{
  open: boolean;
  shareUrl: string;
  shareCfg: ShareConfig | null;
  copied: boolean;
  shareEnabled: boolean;
  shareDays: string;
  sharePassword: string;
  shareMaxViews: string;
  shareSaving: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:shareEnabled": [value: boolean];
  "update:shareDays": [value: string];
  "update:sharePassword": [value: string];
  "update:shareMaxViews": [value: string];
  copy: [];
  save: [];
}>();

const { t } = useTranslation();

function onNumberInput(value: string) {
  emit("update:shareDays", value);
}
function onPasswordInput(value: string) {
  emit("update:sharePassword", value);
}
function onMaxViewsInput(value: string) {
  emit("update:shareMaxViews", value);
}
function onEnabled(value: string | number | boolean) {
  emit("update:shareEnabled", Boolean(value));
}
</script>

<template>
  <el-dialog
    :model-value="props.open"
    :title="t('page.agent.s2')"
    width="420px"
    @update:model-value="emit('update:open', $event)"
  >
    <p class="dialog-desc">
      {{ t("page.agent.s84") }}
    </p>
    <div class="share-link">
      <div class="sl-label">
        {{ t("page.agent.s21") }}
      </div>
      <div class="sl-row">
        <code class="sl-url">{{ props.shareUrl }}</code>
        <el-button
          size="small"
          @click="emit('copy')"
        >
          <el-icon v-if="props.copied">
            <Check />
          </el-icon>
          <el-icon v-else>
            <CopyDocument />
          </el-icon>
        </el-button>
      </div>
      <div
        v-if="props.shareCfg"
        class="sl-views"
      >
        {{ t("page.agent.s57", { n: props.shareCfg.views }) }}{{ props.shareCfg.maxViews ? t("page.agent.s56", { n: props.shareCfg.maxViews }) : "" }}
      </div>
    </div>
    <div class="share-protect">
      <div>
        <div class="sp-title">
          {{ t("page.agent.s22") }}
        </div>
        <div class="sp-sub">
          {{ t("page.agent.s23") }}
        </div>
      </div>
      <el-switch
        :model-value="props.shareEnabled"
        @update:model-value="onEnabled"
      />
    </div>
    <div
      v-if="props.shareEnabled"
      class="share-fields"
    >
      <div>
        <label class="sf-label">{{ t("page.agent.s24") }}</label>
        <el-input
          :model-value="props.shareDays"
          type="number"
          min="1"
          size="small"
          :placeholder="t('page.agent.s48')"
          @update:model-value="onNumberInput"
        />
      </div>
      <div>
        <label class="sf-label">{{ t("page.agent.s25") }}</label>
        <el-input
          :model-value="props.sharePassword"
          size="small"
          :placeholder="t('page.agent.s49')"
          @update:model-value="onPasswordInput"
        />
        <span
          v-if="props.shareCfg?.passwordHash && !props.sharePassword"
          class="sf-hint"
        >{{ t("page.agent.s26") }}</span>
      </div>
      <div>
        <label class="sf-label">{{ t("page.agent.s27") }}</label>
        <el-input
          :model-value="props.shareMaxViews"
          type="number"
          min="1"
          size="small"
          :placeholder="t('page.agent.s50')"
          @update:model-value="onMaxViewsInput"
        />
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('update:open', false)">
        {{ t("page.agent.s28") }}
      </el-button>
      <el-button
        type="primary"
        :loading="props.shareSaving"
        @click="emit('save')"
      >
        {{ t("common.save") }}
      </el-button>
    </template>
  </el-dialog>
</template>
