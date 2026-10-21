<script setup lang="ts">
// 模型配置（settings/models tab，复刻 ModelSettings）：列表 + 启用开关 +
// 测试 + 删除 + 新增对话框。GET /api/models / PATCH|DELETE /api/models/{id} /
// POST /api/models/test|/api/models。apiKey 只显示掩码。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  fetchModels, patchModel, removeModel, testModel, createModel,
  type ModelConfigSafe, type ProviderPreset,
} from "@/api/models";

const { t } = useTranslation();

const models = ref<ModelConfigSafe[]>([]);
const providers = ref<ProviderPreset[]>([]);
const loading = ref(true);
const showAdd = ref(false);
const testingId = ref<string | null>(null);
const addError = ref<string | null>(null);
const addBusy = ref(false);

const form = ref({
  name: "", provider: "openai", apiKey: "", baseUrl: "",
  chatModel: "", embeddingModel: "",
});

const currentProvider = computed(() => providers.value.find((p) => p.id === form.value.provider));

onMounted(refresh);

async function refresh() {
  try {
    const d = await fetchModels();
    models.value = d.models ?? [];
    providers.value = d.providers ?? [];
  } catch {
    /* ignore */
  }
  loading.value = false;
}

async function patch(id: string, body: Record<string, unknown>) {
  try {
    await patchModel(id, body);
  } catch {
    /* ignore */
  }
  await refresh();
}

async function remove(id: string) {
  try {
    await removeModel(id);
  } catch {
    /* ignore */
  }
  await refresh();
}

async function test(id: string) {
  testingId.value = id;
  try {
    await testModel(id);
  } catch {
    /* ignore */
  }
  await refresh();
  testingId.value = null;
}

function onProviderChange() {
  const p = currentProvider.value;
  form.value.chatModel = p?.chatModels?.[0] ?? "";
  form.value.embeddingModel = p?.embeddingModels?.[0] ?? "";
}

async function submitAdd() {
  if (!form.value.name.trim() || !form.value.baseUrl.trim()) return;
  addBusy.value = true;
  addError.value = null;
  try {
    await createModel({
      name: form.value.name.trim(),
      provider: form.value.provider,
      apiKey: form.value.apiKey || undefined,
      baseUrl: form.value.baseUrl.trim(),
      chatModel: form.value.chatModel,
      embeddingModel: form.value.embeddingModel,
    });
    showAdd.value = false;
    form.value = { name: "", provider: "openai", apiKey: "", baseUrl: "", chatModel: "", embeddingModel: "" };
    await refresh();
  } catch (e) {
    addError.value = e instanceof Error && e.message ? e.message : t("page.settings.s42");
  } finally {
    addBusy.value = false;
  }
}
</script>

<template>
  <div class="space">
    <div class="card">
      <div class="card-head between">
        <h3>{{ t("page.model-settings.s29") }}</h3>
        <el-button
          size="small"
          type="primary"
          @click="showAdd = true"
        >
          + {{ t("page.model-settings.s30") }}
        </el-button>
      </div>
      <div class="card-body">
        <p class="hint">
          {{ t("page.model-settings.s31") }}
        </p>

        <div
          v-if="loading"
          class="hint"
        >
          …
        </div>
        <div
          v-else-if="models.length === 0"
          class="hint"
        >
          {{ t("page.model-settings.s32") }}
        </div>

        <div
          v-for="m in models"
          :key="m.id"
          class="model"
        >
          <div class="model-head">
            <div class="model-title">
              <span class="model-name">{{ m.name }}</span>
              <span class="badge">{{ m.providerName }}</span>
              <span
                v-if="m.isDefault"
                class="badge success"
              >{{ t("page.model-settings.s33") }}</span>
              <span
                v-if="!m.enabled"
                class="badge"
              >{{ t("page.model-settings.s34") }}</span>
            </div>
            <div class="model-actions">
              <el-switch
                :model-value="m.enabled"
                inline-prompt
                @update:model-value="(v: string | number | boolean) => patch(m.id, { enabled: !!v })"
              />
              <el-button
                size="small"
                :loading="testingId === m.id"
                @click="test(m.id)"
              >
                {{ t("page.model-settings.s35") }}
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                @click="remove(m.id)"
              >
                {{ t("common.delete") }}
              </el-button>
            </div>
          </div>
          <div class="model-meta">
            <span>{{ m.chatModel }}</span>
            <span v-if="m.embeddingModel"> · {{ m.embeddingModel }}</span>
            <span class="mono">{{ m.baseUrl }}</span>
            <span
              v-if="m.hasKey"
              class="mono"
            >{{ m.apiKeyMasked }}</span>
          </div>
          <div
            v-if="m.lastTestedAt"
            class="model-meta"
          >
            <span :class="m.lastTestOk ? 'ok' : 'err'">
              {{ m.lastTestOk ? t("page.model-settings.s36") : t("page.model-settings.s37") }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="showAdd"
      :title="t('page.model-settings.s30')"
      width="480px"
    >
      <div class="form">
        <label class="field">
          <span class="label">{{ t("page.model-settings.s5") }}</span>
          <el-input
            v-model="form.name"
            :placeholder="currentProvider?.name"
            required
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.model-settings.s4") }}</span>
          <el-select
            v-model="form.provider"
            @change="onProviderChange"
          >
            <el-option
              v-for="p in providers"
              :key="p.id"
              :value="p.id"
              :label="p.name"
            />
          </el-select>
        </label>
        <label class="field">
          <span class="label">{{ t("page.model-settings.s40") }}</span>
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="t('page.model-settings.s41')"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.model-settings.s42") }}</span>
          <el-input
            v-model="form.baseUrl"
            placeholder="https://api.example.com/v1"
            required
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.model-settings.s43") }}</span>
          <el-input
            v-model="form.chatModel"
            :placeholder="currentProvider?.chatModels?.[0]"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.model-settings.s44") }}</span>
          <el-input
            v-model="form.embeddingModel"
            :placeholder="currentProvider?.embeddingModels?.[0]"
          />
        </label>
        <p
          v-if="addError"
          class="err-text"
        >
          {{ addError }}
        </p>
      </div>
      <template #footer>
        <el-button @click="showAdd = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          :loading="addBusy"
          @click="submitAdd"
        >
          {{ t("common.submit") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.space {
  display: grid;
  gap: 16px;
}
.card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 12px;
}
.card-head {
  padding: 16px 20px 0;
}
.card-head.between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.card-body {
  padding: 12px 20px 20px;
}
.hint {
  margin: 0 0 12px;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.model {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
}
.model:last-child {
  margin-bottom: 0;
}
.model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.model-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.model-name {
  font-size: 14px;
  font-weight: 600;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.badge.success {
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  flex-wrap: wrap;
}
.mono {
  font-family: var(--font-mono);
  word-break: break-all;
}
.ok {
  color: hsl(var(--success));
}
.err,
.err-text {
  color: hsl(var(--destructive));
}
.form {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
</style>
