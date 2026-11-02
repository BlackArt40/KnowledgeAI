<script setup lang="ts">
// 共享与分发：知识库 / 文档的公开分享链接（创建 / 复制 / 撤销）。
// 只做展示与表单，请求由父页面经 @/api/kb 发起（组件内不写 fetch）。
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { Check, CopyDocument, Delete } from "@element-plus/icons-vue";
import type { ShareLink, ShareInput } from "@/api/kb";

const props = defineProps<{
  open: boolean;
  title: string;
  subtitle?: string;
  share: ShareLink | null;
  link: string;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  create: [payload: ShareInput];
  revoke: [];
}>();

const { t } = useTranslation();
const days = ref("7");
const maxViews = ref("");
const password = ref("");
const copied = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    days.value = "7";
    maxViews.value = "";
    password.value = "";
    copied.value = false;
  }
);

const expiryText = computed(() => {
  const at = props.share?.expiresAt;
  return at ? t("page.share-link-dialog.s16", { date: new Date(at).toLocaleDateString() }) : t("page.share-link-dialog.s17");
});

const viewsText = computed(() => {
  const share = props.share;
  if (!share) return "";
  return share.maxViews !== null
    ? t("page.share-link-dialog.s19", { views: share.views, max: share.maxViews })
    : t("page.share-link-dialog.s22", { views: share.views });
});

function createLink() {
  const d = Number(days.value);
  const limit = maxViews.value.trim();
  const n = Number(limit);
  emit("create", {
    expiresAt: d > 0 ? Date.now() + d * 86_400_000 : null,
    password: password.value.trim() || null,
    maxViews: limit && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null,
  });
}

async function copyLink() {
  // 非安全上下文（http / 权限拒绝）没有 clipboard API：直接返回，
  // 不假装复制成功（链接始终显示在文本框里可手动选中）。
  if (!navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(props.link);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    /* 剪贴板不可用（http / 权限拒绝）：链接仍可从文本框手动复制 */
  }
}
</script>

<template>
  <el-dialog
    :model-value="props.open"
    :title="props.title"
    width="440px"
    @update:model-value="emit('update:open', $event)"
  >
    <p
      v-if="props.subtitle"
      class="dlg-sub"
    >
      {{ props.subtitle }}
    </p>

    <div
      v-if="props.loading"
      class="sk"
      style="height: 88px"
    />

    <template v-else-if="props.share">
      <div class="share-box">
        <p class="share-label">
          {{ t("page.share-link-dialog.s0") }}
        </p>
        <div class="share-row">
          <code
            class="share-url"
            data-testid="share-url"
          >{{ props.link }}</code>
          <el-button
            size="small"
            @click="copyLink"
          >
            <el-icon>
              <Check v-if="copied" />
              <CopyDocument v-else />
            </el-icon>
            {{ copied ? t("page.share-link-dialog.s6") : t("page.share-link-dialog.s7") }}
          </el-button>
        </div>
        <div class="share-meta">
          <span>{{ expiryText }}</span>
          <span>{{ viewsText }}</span>
        </div>
      </div>
      <el-button
        class="share-revoke"
        type="danger"
        plain
        size="small"
        @click="emit('revoke')"
      >
        <el-icon><Delete /></el-icon>
        {{ t("page.share-link-dialog.s20") }}
      </el-button>
    </template>

    <template v-else>
      <p class="share-hint">
        {{ t("page.share-link-dialog.s23") }}
      </p>
      <div class="share-form">
        <label class="field">
          <span class="label">{{ t("page.share-link-dialog.s1") }}</span>
          <el-input
            v-model="days"
            type="number"
            min="0"
            :placeholder="t('page.share-link-dialog.s2')"
          />
          <span class="hint">{{ t("page.share-link-dialog.s2") }}</span>
        </label>
        <label class="field">
          <span class="label">{{ t("page.share-link-dialog.s3") }}</span>
          <el-input
            v-model="maxViews"
            type="number"
            min="1"
            :placeholder="t('page.share-link-dialog.s8')"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.share-link-dialog.s4") }}</span>
          <el-input
            v-model="password"
            show-password
            :placeholder="t('page.share-link-dialog.s9')"
          />
        </label>
      </div>
    </template>

    <p
      v-if="props.error"
      class="err"
    >
      {{ props.error }}
    </p>

    <template #footer>
      <el-button @click="emit('update:open', false)">
        {{ t("page.share-link-dialog.s5") }}
      </el-button>
      <el-button
        v-if="!props.loading && !props.share"
        type="primary"
        :loading="props.saving"
        @click="createLink"
      >
        {{ t("page.share-link-dialog.s21") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dlg-sub {
  margin: 0 0 12px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.share-box {
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.3);
}
.share-label {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.share-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.share-url {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: hsl(var(--background));
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.share-revoke {
  margin-top: 12px;
  width: 100%;
}
.share-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.share-form {
  display: grid;
  gap: 12px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.err {
  margin: 10px 0 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}
</style>
