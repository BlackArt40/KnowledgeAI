<script setup lang="ts">
// 开发者门户（V5，复刻 src/app/(app)/developer/page.tsx）：四 tab——
// 快速开始（JS/Python/Go SDK 示例 + /docs 链接）、Webhook 管理（订阅 CRUD/
// 测试/投递记录）、用量统计（24h 按小时分桶调用图 + 端点分布）、集成
// （IntegrationsPanel）。owner/admin/editor（routeGuard 兜底）。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Document, Promotion, TrendCharts, Setting, Plus, Delete } from "@element-plus/icons-vue";
import {
  fetchWebhooks, fetchCallLogs, createWebhook, patchWebhook, deleteWebhook, testWebhook,
  type WebhookSub, type Delivery, type CallLog,
} from "@/api/developer";
import UsageChart from "@/components/UsageChart.vue";
import IntegrationsPanel from "@/components/developer/IntegrationsPanel.vue";

const EVENTS = ["kb.ready", "agent.completed", "usage.alert"] as const;

const { t } = useTranslation();

const tab = ref("quickstart");
const loading = ref(true);
const webhooks = ref<WebhookSub[]>([]);
const deliveries = ref<Delivery[]>([]);
const logs = ref<CallLog[]>([]);

const createOpen = ref(false);
const whName = ref("");
const whUrl = ref("");
const whSecret = ref("");
const whEvents = ref<string[]>(["kb.ready"]);
const creating = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  try {
    const [wh, lg] = await Promise.all([fetchWebhooks(), fetchCallLogs()]);
    webhooks.value = wh.webhooks;
    deliveries.value = wh.deliveries;
    logs.value = lg;
  } catch {
    /* keep lists */
  }
  loading.value = false;
}

onMounted(() => void load());

async function submitCreate() {
  error.value = "";
  if (!whUrl.value.trim()) {
    error.value = t("page.developer.s26");
    return;
  }
  if (whEvents.value.length === 0) {
    error.value = t("page.developer.s27");
    return;
  }
  creating.value = true;
  try {
    await createWebhook({ name: whName.value, url: whUrl.value, secret: whSecret.value, events: whEvents.value });
    createOpen.value = false;
    whName.value = "";
    whUrl.value = "";
    whSecret.value = "";
    whEvents.value = ["kb.ready"];
    void load();
  } catch (e) {
    error.value = e instanceof Error && e.message && !e.message.startsWith("API ") ? e.message : t("page.developer.s25");
  } finally {
    creating.value = false;
  }
}

async function toggleWebhook(sub: WebhookSub) {
  try {
    await patchWebhook(sub.id, { active: !sub.active });
  } catch {
    /* ignore */
  }
  void load();
}

async function removeWebhook(id: string) {
  try {
    await deleteWebhook(id);
  } catch {
    /* ignore */
  }
  void load();
}

async function runTest(id: string) {
  try {
    await testWebhook(id);
  } catch {
    /* ignore */
  }
  void load();
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 调用日志按小时分桶（近 24h）供用量图使用 */
const hourBuckets = computed(() => {
  const now = Date.now();
  const labels: string[] = [];
  const data: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - i * 3600_000;
    const end = start + 3600_000;
    labels.push(i % 3 === 0 ? `${new Date(start).getHours()}h` : "");
    data.push(logs.value.filter((l) => l.ts >= start && l.ts < end).length);
  }
  return { labels, data };
});

const totalCalls = computed(() => logs.value.length);
const avgLatency = computed(() =>
  logs.value.length ? Math.round(logs.value.reduce((s, l) => s + l.latencyMs, 0) / logs.value.length) : 0
);
const byEndpoint = computed(() => {
  const m = new Map<string, number>();
  for (const l of logs.value) m.set(l.endpoint, (m.get(l.endpoint) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
</script>

<template>
  <div class="dev-page">
    <el-tabs
      v-model="tab"
      class="dev-tabs"
    >
      <el-tab-pane
        name="quickstart"
      >
        <template #label>
          <span class="tab-label"><el-icon :size="13"><Document /></el-icon> {{ t("page.developer.s0") }}</span>
        </template>

        <!-- 快速开始 -->
        <div class="card">
          <h3 class="card-title">
            {{ t("page.developer.s4") }}
          </h3>
          <p class="card-desc">
            {{ t("page.developer.s5") }}
            <a
              href="/docs"
              target="_blank"
              class="docs-link"
            >{{ t("page.developer.s6") }}</a>
          </p>
          <div class="body">
            <div class="snippet">
              <p class="snippet-label">
                JavaScript
              </p>
              <pre class="code">{{
                `import { KnowledgeAI } from "kai-sdk.mjs";

const kai = new KnowledgeAI({ apiKey: "kai_sk_...", baseUrl: "http://localhost:3000" });
const { kbs } = await kai.listKnowledgeBases();
await kai.ask(kbs[0].id, "${t("page.developer.s71")}", {
  onToken: (text) => process.stdout.write(text),
});`
              }}</pre>
            </div>
            <div class="snippet">
              <p class="snippet-label">
                Python
              </p>
              <pre class="code">{{
                `from kai_sdk import KnowledgeAI

kai = KnowledgeAI(api_key="kai_sk_...", base_url="http://localhost:3000")
print(kai.list_knowledge_bases())
done = kai.ask("kb_xxx", "${t("page.developer.s71")}", on_token=lambda t: print(t, end=""))`
              }}</pre>
            </div>
            <div class="snippet">
              <p class="snippet-label">
                Go
              </p>
              <pre class="code">{{
                `client := kai.New("kai_sk_...", "http://localhost:3000")
kbs, _ := client.ListKnowledgeBases(ctx)
done, _ := client.Ask(ctx, "kb_xxx", "${t("page.developer.s71")}", nil)`
              }}</pre>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="webhooks">
        <template #label>
          <span class="tab-label"><el-icon :size="13"><Promotion /></el-icon> {{ t("page.developer.s1") }}</span>
        </template>

        <!-- Webhook 管理 -->
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">
                {{ t("page.developer.s7") }}
              </h3>
              <p class="card-desc">
                {{ t("page.developer.s8") }}
              </p>
            </div>
            <el-button
              size="small"
              :icon="Plus"
              @click="createOpen = true"
            >
              {{ t("page.developer.s9") }}
            </el-button>
          </div>
          <div class="body">
            <div
              v-if="loading"
              class="sk"
            />
            <p
              v-else-if="webhooks.length === 0"
              class="hint"
            >
              {{ t("page.developer.s19") }}
            </p>
            <table
              v-else
              class="tbl"
            >
              <thead>
                <tr>
                  <th>{{ t("page.developer.s11") }}</th>
                  <th>{{ t("page.developer.s12") }}</th>
                  <th>{{ t("page.developer.s15") }}</th>
                  <th>{{ t("page.developer.s20") }}</th>
                  <th class="right">
                    {{ t("page.developer.s21") }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="sub in webhooks"
                  :key="sub.id"
                >
                  <td>
                    <div class="w-name">
                      {{ sub.name }}
                    </div>
                    <div class="w-id">
                      {{ sub.id }}
                    </div>
                  </td>
                  <td class="w-url">
                    {{ sub.url }}
                  </td>
                  <td>
                    <div class="ev-list">
                      <span
                        v-for="ev in sub.events"
                        :key="ev"
                        class="badge outline mono"
                      >{{ ev }}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      v-if="sub.failures > 0"
                      class="badge bad"
                    >{{ t("page.developer.s22") }} {{ sub.failures }}{{ sub.lastError ? ` · ${sub.lastError}` : "" }}</span>
                    <span
                      v-else-if="sub.active"
                      class="badge ok"
                    >{{ t("page.developer.s23") }}</span>
                    <span
                      v-else
                      class="badge muted"
                    >{{ t("page.developer.s24") }}</span>
                  </td>
                  <td class="right ops">
                    <el-switch
                      :model-value="sub.active"
                      @change="() => toggleWebhook(sub)"
                    />
                    <el-button
                      size="small"
                      :icon="Promotion"
                      :title="t('page.developer.s28')"
                      @click="runTest(sub.id)"
                    />
                    <el-button
                      size="small"
                      text
                      type="danger"
                      :icon="Delete"
                      @click="removeWebhook(sub.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="deliveries.length > 0"
            >
              <p class="sub-title">
                {{ t("page.developer.s29") }}
              </p>
              <table class="tbl">
                <thead>
                  <tr>
                    <th>{{ t("page.developer.s30") }}</th>
                    <th>{{ t("page.developer.s31") }}</th>
                    <th>{{ t("page.developer.s32") }}</th>
                    <th>{{ t("page.developer.s33") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="d in deliveries.slice(0, 15)"
                    :key="d.id"
                  >
                    <td class="mono-cell">
                      {{ d.event }}
                    </td>
                    <td>
                      <span
                        v-if="d.status === 'dead'"
                        class="badge bad"
                      >{{ t("page.developer.s22") }}</span>
                      <span
                        v-else-if="d.status === 'error'"
                        class="badge bad"
                      >{{ d.detail ?? "error" }}</span>
                      <span
                        v-else
                        class="badge ok"
                      >{{ d.status }}</span>
                    </td>
                    <td class="hint">
                      {{ fmtTime(d.ts) }}
                    </td>
                    <td class="hint">
                      {{ d.latencyMs }}ms
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="usage">
        <template #label>
          <span class="tab-label"><el-icon :size="13"><TrendCharts /></el-icon> {{ t("page.developer.s2") }}</span>
        </template>

        <!-- 用量统计 -->
        <div class="usage-cards">
          <div class="card">
            <p class="hint">
              {{ t("page.developer.s34") }}
            </p>
            <p class="usage-val">
              {{ totalCalls }}
            </p>
          </div>
          <div class="card">
            <p class="hint">
              {{ t("page.developer.s35") }}
            </p>
            <p class="usage-val">
              {{ webhooks.length }}
            </p>
          </div>
          <div class="card">
            <p class="hint">
              {{ t("page.developer.s36") }}
            </p>
            <p class="usage-val">
              {{ avgLatency }}ms
            </p>
          </div>
          <div class="card">
            <p class="hint">
              {{ t("page.developer.s37") }}
            </p>
            <p class="usage-val">
              {{ logs.length > 0 ? new Date(logs[0].ts).toLocaleDateString() : "-" }}
            </p>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">
            {{ t("page.developer.s38") }}
          </h3>
          <p class="card-desc">
            {{ t("page.developer.s39") }}
          </p>
          <UsageChart
            :data="hourBuckets.data"
            :labels="hourBuckets.labels"
          />
        </div>
        <div class="card">
          <h3 class="card-title">
            {{ t("page.developer.s40") }}
          </h3>
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ t("page.developer.s41") }}</th>
                <th class="right">
                  {{ t("page.developer.s42") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="[endpoint, count] in byEndpoint"
                :key="endpoint"
              >
                <td class="mono-cell">
                  {{ endpoint }}
                </td>
                <td class="right num">
                  {{ count }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </el-tab-pane>

      <el-tab-pane name="integrations">
        <template #label>
          <span class="tab-label"><el-icon :size="13"><Setting /></el-icon> {{ t("page.developer.s3") }}</span>
        </template>
        <IntegrationsPanel />
      </el-tab-pane>
    </el-tabs>

    <!-- 新建 Webhook 对话框 -->
    <el-dialog
      v-model="createOpen"
      :title="t('page.developer.s9')"
      width="440px"
    >
      <p class="dialog-desc">
        {{ t("page.developer.s10") }}
      </p>
      <div class="dialog-form">
        <label class="lbl">{{ t("page.developer.s11") }}</label>
        <el-input
          v-model="whName"
          :placeholder="t('page.developer.s72')"
        />
        <label class="lbl">{{ t("page.developer.s12") }}</label>
        <el-input
          v-model="whUrl"
          placeholder="https://example.com/webhooks/kai"
        />
        <label class="lbl">{{ t("page.developer.s13") }}</label>
        <el-input
          v-model="whSecret"
          :placeholder="t('page.developer.s14')"
        />
        <label class="lbl">{{ t("page.developer.s15") }}</label>
        <div class="ev-checks">
          <label
            v-for="ev in EVENTS"
            :key="ev"
            class="ev-check"
          >
            <input
              type="checkbox"
              :checked="whEvents.includes(ev)"
              @change="(e: Event) => {
                const checked = (e.target as HTMLInputElement).checked;
                whEvents = checked ? [...whEvents, ev] : whEvents.filter((x) => x !== ev);
              }"
            >
            <code class="mono">{{ ev }}</code>
          </label>
        </div>
        <p
          v-if="error"
          class="err-text"
        >
          {{ error }}
        </p>
      </div>
      <template #footer>
        <el-button @click="createOpen = false">
          {{ t("page.developer.s16") }}
        </el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="submitCreate"
        >
          {{ creating ? t("page.developer.s17") : t("page.developer.s18") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.dev-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}
/* 窄屏：四个带图标的分页会把 tabs 撑到 700px+，改为横向滚动 */
.dev-tabs {
  min-width: 0;
}
.dev-tabs :deep(.el-tabs__nav-wrap) {
  overflow-x: auto;
  scrollbar-width: none;
}
.dev-tabs :deep(.el-tabs__nav-wrap)::-webkit-scrollbar {
  display: none;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.card { min-width: 0; padding: 20px; border-radius: var(--radius-lg); margin-bottom: 16px; }

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.card-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.docs-link {
  margin-left: 4px;
  color: hsl(var(--primary));
  text-decoration: none;
}
.docs-link:hover {
  text-decoration: underline;
}
.body {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}
.snippet {
  min-width: 0;
  padding: 12px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-sm);
  background: hsl(var(--muted) / 0.4);
}
.snippet-label {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.code {
  margin: 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.7;
  font-family: var(--font-mono, monospace);
}
.sub-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  padding: 6px 8px;
  border-bottom: 1px solid hsl(var(--border));
  text-align: left;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.tbl td {
  padding: 10px 8px;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
}
.tbl tbody tr:last-child td {
  border-bottom: 0;
}
.right {
  text-align: right;
}
.w-name {
  font-weight: 500;
}
.w-id {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.w-url {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.ev-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.badge { font-weight: 500; }

.badge.ok { background: hsl(142 71% 45% / 0.12); color: hsl(142 71% 35%); }
.badge.bad { background: hsl(var(--destructive) / 0.12); color: hsl(var(--destructive)); }
.badge.muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.badge.outline { border: 1px solid hsl(var(--border)); color: hsl(var(--muted-foreground)); }
.mono {
  font-family: var(--font-mono, monospace);
}
.mono-cell {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.hint { font-size: 13px; }

.sk { height: 96px; border-radius: var(--radius-sm); }

.usage-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
@media (min-width: 1024px) {
  .usage-cards {
    grid-template-columns: repeat(4, 1fr);
  }
}
.usage-cards .card {
  margin-bottom: 0;
}
.usage-val {
  margin: 4px 0 0;
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.num {
  font-variant-numeric: tabular-nums;
}
.dialog-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.dialog-form {
  display: grid;
  gap: 10px;
}
.lbl {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
.ev-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 4px;
}
.ev-check {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.err-text {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}
</style>
