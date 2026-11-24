<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import { patchPrivacy, type SecurityState } from "@/api/security";

const { t } = useTranslation();
const props = defineProps<{ privacy: SecurityState["privacy"] }>();
const emit = defineEmits<{ changed: []; delete: [] }>();

async function patch(patch: Record<string, unknown>) {
  try {
    await patchPrivacy(patch);
  } catch {
    /* ignore */
  }
  emit("changed");
}
function exportData() {
  window.open("/api/security/export", "_blank");
}
</script>

<template>
  <div class="space">
    <div class="card">
      <div class="card-head">
        <h2>{{ t("page.settings.s8") }}</h2>
      </div>
      <div class="card-body">
        <div class="pref-row">
          <div>
            <p class="pref-label">
              {{ t("page.settings.s66") }}
            </p>
            <p class="hint">
              {{ t("page.settings.s67") }}
            </p>
          </div>
          <el-switch
            :model-value="props.privacy.analytics"
            :aria-label="t('page.settings.s66')"
            @update:model-value="(v: string | number | boolean) => patch({ analytics: !!v })"
          />
        </div>
        <div class="pref-row">
          <div>
            <p class="pref-label">
              {{ t("page.settings.s68") }}
            </p>
            <p class="hint">
              {{ t("page.settings.s69") }}
            </p>
          </div>
          <el-switch
            :model-value="props.privacy.crashReports"
            :aria-label="t('page.settings.s68')"
            @update:model-value="(v: string | number | boolean) => patch({ crashReports: !!v })"
          />
        </div>
        <div class="pref-row">
          <div>
            <p class="pref-label">
              {{ t("page.settings.s70") }}
            </p>
            <p class="hint">
              {{ t("page.settings.s71") }}
            </p>
          </div>
          <el-switch
            :model-value="props.privacy.trainingOptIn"
            :aria-label="t('page.settings.s70')"
            @update:model-value="(v: string | number | boolean) => patch({ trainingOptIn: !!v })"
          />
        </div>
        <div class="divider" />
        <div class="pref-row">
          <div>
            <p class="pref-label">
              {{ t("page.settings.s26") }}
            </p>
            <p class="hint">
              {{ t("page.settings.s27") }}
            </p>
          </div>
          <el-select
            :model-value="String(props.privacy.dataRetentionDays)"
            style="width: 120px"
            :aria-label="t('page.settings.s26')"
            @update:model-value="(v: string | number | boolean) => patch({ dataRetentionDays: Number(v) })"
          >
            <el-option
              value="30"
              :label="t('page.settings.s28')"
            />
            <el-option
              value="60"
              :label="t('page.settings.s29')"
            />
            <el-option
              value="90"
              :label="t('page.settings.s30')"
            />
            <el-option
              value="180"
              :label="t('page.settings.s31')"
            />
            <el-option
              value="365"
              :label="t('page.settings.s32')"
            />
          </el-select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>{{ t("page.settings.s33") }}</h2>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.settings.s91") }}
        </p>
        <div class="btns">
          <el-button @click="exportData">
            {{ t("page.settings.s92") }}
          </el-button>
          <el-button
            type="danger"
            @click="emit('delete')"
          >
            {{ t("page.settings.s93") }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../settings.css"></style>
