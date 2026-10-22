<script setup lang="ts">
// 聊天顶部工具栏：KB 选择、来源面板入口、导出与共享。样式在
// @/styles/chat-view.css（全局命名空间 .chat-page）。
import { useTranslation } from "i18next-vue";
import { ChatDotRound, Collection, Download, Search, Share } from "@element-plus/icons-vue";
import type { KbListItem } from "@/api/kb";

const props = withDefaults(defineProps<{
  kbs: KbListItem[];
  selectedKb: string;
  selectedKbObj?: KbListItem | null;
  activeConv: string | null;
  messagesCount: number;
  activeIsMine: boolean;
  activeIsShared: boolean;
}>(), { selectedKbObj: null });

const emit = defineEmits<{
  "change-kb": [value: string];
  "open-drawer": [];
  "open-sources": [];
  export: [];
  "toggle-share": [];
}>();

const { t } = useTranslation();

function onKbChange(value: string | number | boolean) {
  emit("change-kb", String(value));
}
</script>

<template>
  <header class="chat-head">
    <button
      type="button"
      class="icon-btn lg-only-hidden"
      :aria-label="t('page.chat.s0')"
      @click="emit('open-drawer')"
    >
      <el-icon :size="14">
        <ChatDotRound />
      </el-icon>
    </button>
    <span
      v-if="props.kbs.length === 0"
      class="kb-hint"
    >{{ t("page.chat.s1") }}</span>
    <el-select
      v-else
      :model-value="props.selectedKb"
      class="kb-select"
      size="small"
      :aria-label="t('page.agent.s37')"
      @update:model-value="onKbChange"
    >
      <el-option
        v-for="kb in props.kbs"
        :key="kb.id"
        :value="kb.id"
        :label="kb.name"
      >
        <span class="kb-opt">
          <el-icon
            :size="12"
            class="kb-opt-ico"
          >
            <Collection />
          </el-icon>
          {{ kb.name }} · {{ t("page.chat.s70", { count: kb.stats.ready }) }}{{ kb.shared ? t("page.chat.s57", { name: kb.ownerName ?? "" }) : "" }}
        </span>
      </el-option>
    </el-select>
    <span
      v-if="props.selectedKbObj"
      class="ready-badge"
    >{{ t("page.chat.s71", { count: props.selectedKbObj.stats.ready }) }}</span>
    <button
      type="button"
      class="src-btn"
      :aria-label="t('page.chat.s5')"
      @click="emit('open-sources')"
    >
      <el-icon :size="12">
        <Search />
      </el-icon>
      <span class="src-btn-text">{{ t("page.chat.s2") }}</span>
    </button>
    <el-button
      v-if="props.activeConv && props.messagesCount > 0"
      size="small"
      :icon="Download"
      :aria-label="t('page.chat.s18')"
      @click="emit('export')"
    >
      <span class="btn-text">{{ t("page.chat.s3") }}</span>
    </el-button>
    <el-button
      v-if="props.activeIsMine"
      size="small"
      :icon="Share"
      :class="{ 'share-on': props.activeIsShared }"
      :aria-label="props.activeIsShared ? t('page.chat.s19') : t('page.chat.s20')"
      :title="props.activeIsShared ? t('page.chat.s21') : t('page.chat.s22')"
      @click="emit('toggle-share')"
    >
      <span class="btn-text">{{ props.activeIsShared ? t("page.chat.s23") : t("page.chat.s24") }}</span>
    </el-button>
  </header>
</template>
