<script setup lang="ts">
// 外观 tab（P5-5）：主题三模式 + 高对比度（本地 kai-theme/kai-hc）+
// 工作区品牌色（owner-only，PATCH /api/workspaces 持久化）。共享主题引擎。
import { onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Check, View } from "@element-plus/icons-vue";
import {
  BRAND_COLORS, applyBrandColor, DEFAULT_BRAND_COLOR,
} from "@shared/theme/brand-colors";
import { applyHighContrast, getHighContrast, type ThemeMode } from "@shared/theme/mode";
import { fetchWorkspaces, saveBrandColor } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { useThemeStore } from "@/stores/theme";

const { t } = useTranslation();
const theme = useThemeStore();

const hc = ref(false);
const brand = ref(DEFAULT_BRAND_COLOR);
const isOwner = ref(false);
const saving = ref(false);
const msg = ref<{ ok: boolean; text: string } | null>(null);

const MODE_OPTIONS: { mode: ThemeMode; labelKey: string }[] = [
  { mode: "light", labelKey: "page.theme-settings.modeLight" },
  { mode: "dark", labelKey: "page.theme-settings.modeDark" },
  { mode: "system", labelKey: "page.theme-settings.modeSystem" },
];

onMounted(async () => {
  hc.value = getHighContrast();
  try {
    const d = await fetchWorkspaces();
    const cur = d.workspaces?.find((w) => w.id === d.currentWorkspace);
    if (cur) {
      brand.value = cur.brandColor ?? DEFAULT_BRAND_COLOR;
      isOwner.value = !!cur.isOwner;
    }
  } catch {
    /* ignore */
  }
});

function selectMode(m: ThemeMode) {
  theme.setMode(m, { animate: true });
}

function toggleHc(on: boolean) {
  hc.value = on;
  applyHighContrast(on);
}

async function selectBrand(id: string) {
  if (!isOwner.value || id === brand.value) return;
  saving.value = true;
  msg.value = null;
  try {
    await saveBrandColor(id);
    brand.value = id;
    applyBrandColor(id);
    msg.value = { ok: true, text: t("page.theme-settings.saveOk") };
  } catch (e) {
    msg.value = { ok: false, text: e instanceof ApiError && e.message ? e.message : t("page.theme-settings.saveError") };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space">
    <div class="card">
      <div class="card-head">
        <h3>{{ t("page.theme-settings.modeTitle") }}</h3>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.theme-settings.modeHint") }}
        </p>
        <div class="mode-grid">
          <button
            v-for="m in MODE_OPTIONS"
            :key="m.mode"
            type="button"
            class="mode-btn"
            :class="{ active: theme.mode === m.mode }"
            :aria-pressed="theme.mode === m.mode"
            @click="selectMode(m.mode)"
          >
            {{ t(m.labelKey) }}
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head between">
        <h3 class="with-icon">
          <el-icon :size="14">
            <View />
          </el-icon> {{ t("page.theme-settings.hcTitle") }}
        </h3>
        <el-switch
          :model-value="hc"
          :aria-label="t('page.theme-settings.hcTitle')"
          @update:model-value="(v: string | number | boolean) => toggleHc(!!v)"
        />
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.theme-settings.hcHint") }}
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>{{ t("page.theme-settings.brandTitle") }}</h3>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.theme-settings.brandHint") }}
        </p>
        <div class="swatches">
          <button
            v-for="c in BRAND_COLORS"
            :key="c.id"
            type="button"
            class="swatch"
            :disabled="!isOwner || saving"
            :aria-label="t(c.labelKey)"
            :aria-pressed="brand === c.id"
            :title="t(c.labelKey)"
            :style="{ backgroundColor: c.swatch }"
            @click="selectBrand(c.id)"
          >
            <el-icon
              v-if="brand === c.id"
              :size="14"
              color="#fff"
            >
              <Check />
            </el-icon>
          </button>
        </div>
        <p
          v-if="!isOwner"
          class="hint"
        >
          {{ t("page.theme-settings.brandOwnerOnly") }}
        </p>
        <p
          v-if="msg"
          class="hint msg"
          :class="msg.ok ? 'ok' : 'err'"
        >
          {{ msg.text }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.space {
  display: grid;
  gap: 16px;
}
.card-head {
  padding: 16px 20px 0;
}
.card-head h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint { margin: 0 0 12px; }

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.mode-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.mode-btn.active {
  border-color: hsl(var(--primary) / 0.4);
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.swatch {
  display: flex;
  height: 40px;
  width: 40px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: transform 0.15s;
}
.swatch:not(:disabled):hover {
  transform: scale(1.1);
}
.swatch:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.msg.ok {
  color: hsl(var(--success));
}
.msg.err {
  color: hsl(var(--destructive));
}
</style>
