<script setup lang="ts">
// 集成市场（V5，复刻 src/components/app/developer-integrations.tsx）：
// Embeddable Widget 片段生成（apiKey/kbId → 可复制 script）+ 群机器人管理
// （创建一次性 token/启停/删除）+ Chrome 扩展 + n8n/Zapier 文档 + Notion/
// Confluence 文档同步（同步结果计数）。文案全走 page.developer.s44+。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Plus, Delete, CopyDocument, Check, MagicStick, Compass, Setting, RefreshRight, Download, Loading } from "@element-plus/icons-vue";
import { fetchKbs } from "@/api/kb";
import {
  fetchBots, createBot, patchBot, deleteBot, runSync,
  type BotBinding,
} from "@/api/developer";

const PLATFORMS = ["slack", "feishu", "dingtalk", "test"] as const;

const { t } = useTranslation();

const bots = ref<BotBinding[]>([]);
const kbs = ref<{ id: string; name: string }[]>([]);
const loading = ref(true);
const copied = ref("");

const widgetKey = ref("");
const widgetKb = ref("");

const createOpen = ref(false);
const botName = ref("");
const botPlatform = ref<string>("slack");
const botKb = ref("");
const botToken = ref<{ token: string; id: string } | null>(null);
const error = ref("");

const syncKb = ref("");
const notionDb = ref("");
const confSpace = ref("");
const syncing = ref<"notion" | "confluence" | null>(null);
const syncResult = ref<{
  source: "notion" | "confluence";
  imported: number;
  skipped: number;
  failed: number;
  error?: string;
} | null>(null);

async function load() {
  loading.value = true;
  try {
    const [b, k] = await Promise.all([
      fetchBots(),
      fetchKbs().then((list) => list.map((x) => ({ id: x.id, name: x.name }))).catch(() => []),
    ]);
    bots.value = b;
    kbs.value = k;
  } catch {
    /* keep lists */
  }
  loading.value = false;
}

onMounted(() => void load());

function copy(text: string, tag: string) {
  void navigator.clipboard?.writeText(text);
  copied.value = tag;
  setTimeout(() => (copied.value = ""), 1500);
}

async function submitCreateBot() {
  error.value = "";
  if (!botKb.value) {
    error.value = t("page.developer.s59");
    return;
  }
  try {
    const d = await createBot({ name: botName.value, platform: botPlatform.value, kbId: botKb.value });
    botToken.value = { token: d.bot.token, id: d.bot.id };
    createOpen.value = false;
    botName.value = "";
    botKb.value = "";
    void load();
  } catch (e) {
    error.value = e instanceof Error && e.message && !e.message.startsWith("API ") ? e.message : t("page.developer.s25");
  }
}

async function toggleBot(bot: BotBinding) {
  try {
    await patchBot(bot.id, { active: !bot.active });
  } catch {
    /* ignore */
  }
  void load();
}

async function removeBot(id: string) {
  try {
    await deleteBot(id);
  } catch {
    /* ignore */
  }
  void load();
}

async function doSync(source: "notion" | "confluence") {
  if (!syncKb.value) {
    syncResult.value = { source, imported: 0, skipped: 0, failed: 0, error: t("page.developer.s59") };
    return;
  }
  if (source === "notion" && !notionDb.value.trim()) {
    syncResult.value = { source, imported: 0, skipped: 0, failed: 0, error: t("page.developer.s86") };
    return;
  }
  if (source === "confluence" && !confSpace.value.trim()) {
    syncResult.value = { source, imported: 0, skipped: 0, failed: 0, error: t("page.developer.s87") };
    return;
  }
  syncing.value = source;
  syncResult.value = null;
  try {
    const d = await runSync(
      source,
      source === "notion"
        ? { kbId: syncKb.value, databaseId: notionDb.value.trim() }
        : { kbId: syncKb.value, spaceKey: confSpace.value.trim() }
    );
    syncResult.value = { source, imported: d.imported ?? 0, skipped: d.skipped ?? 0, failed: d.failed ?? 0 };
  } catch {
    syncResult.value = { source, imported: 0, skipped: 0, failed: 0, error: t("page.developer.s88") };
  } finally {
    syncing.value = null;
  }
}

const origin = typeof window !== "undefined" ? window.location.origin : "";
// 注意：字符串里的闭合 script 标签必须写成 <\/script>（含注释内）——SFC 的
// script 块按裸文本解析，字面的闭合序列会提前终止块，导致模板丢失 setup 绑定。
const widgetSnippet = computed(
  () => `<!-- ${t("page.developer.s73")} -->
<script src="${origin}/widget/kai-widget.js"><\/script>
<script>
  KnowledgeAIWidget.init({
    endpoint: "${origin}",
    apiKey: "${widgetKey.value}",
    kbId: "${widgetKb.value}",
    title: "${t("page.developer.s67")}",
  });
<\/script>`
);
</script>

<template>
  <div class="integrations">
    <!-- Embeddable Widget -->
    <div class="card">
      <h3 class="card-title">
        <el-icon
          :size="14"
          class="title-ico"
        >
          <Compass />
        </el-icon>
        {{ t("page.developer.s44") }}
      </h3>
      <p class="card-desc">
        {{ t("page.developer.s45") }}
      </p>
      <div class="body">
        <div class="grid2">
          <div>
            <label class="lbl">{{ t("page.developer.s46") }}</label>
            <el-input
              v-model="widgetKey"
              placeholder="kai_sk_...（chat:read）"
            />
          </div>
          <div>
            <label class="lbl">{{ t("page.developer.s47") }}</label>
            <el-select
              v-model="widgetKb"
              :placeholder="t('page.developer.s48')"
            >
              <el-option
                v-for="kb in kbs"
                :key="kb.id"
                :value="kb.id"
                :label="kb.name"
              />
            </el-select>
          </div>
        </div>
        <div class="snippet">
          <pre class="code">{{ widgetSnippet }}</pre>
          <el-button
            size="small"
            class="snippet-copy"
            @click="copy(widgetSnippet, 'widget')"
          >
            <el-icon
              v-if="copied === 'widget'"
              class="ok-text"
            >
              <Check />
            </el-icon>
            <el-icon
              v-else
            >
              <CopyDocument />
            </el-icon>
            {{ copied === "widget" ? t("page.developer.s50") : t("page.developer.s49") }}
          </el-button>
        </div>
        <p class="hint">
          {{ t("page.developer.s51") }}
        </p>
      </div>
    </div>

    <!-- 群机器人 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <MagicStick />
            </el-icon>
            {{ t("page.developer.s52") }}
          </h3>
          <p class="card-desc">
            {{ t("page.developer.s53") }}
          </p>
        </div>
        <el-button
          size="small"
          :icon="Plus"
          @click="createOpen = true"
        >
          {{ t("page.developer.s54") }}
        </el-button>
      </div>
      <div class="body">
        <div
          v-if="botToken"
          class="token-box"
        >
          <p class="token-title">
            {{ t("page.developer.s57") }}
          </p>
          <code class="token-code">{{ botToken.token }}</code>
          <div class="token-meta">
            <span>{{ t("page.developer.s58") }}:</span>
            <code class="token-url">{{ origin }}/api/v1/integrations/bot/m/{{ botToken.token }}</code>
          </div>
          <el-button
            size="small"
            class="token-copy"
            @click="copy(botToken.token, 'bottoken')"
          >
            <el-icon
              v-if="copied === 'bottoken'"
              class="ok-text"
            >
              <Check />
            </el-icon>
            <el-icon
              v-else
            >
              <CopyDocument />
            </el-icon>
            {{ copied === "bottoken" ? t("page.developer.s50") : t("page.developer.s49") }}
          </el-button>
        </div>
        <div
          v-if="loading"
          class="sk"
        />
        <p
          v-else-if="bots.length === 0"
          class="hint"
        >
          {{ t("page.developer.s60") }}
        </p>
        <table
          v-else
          class="tbl"
        >
          <thead>
            <tr>
              <th>{{ t("page.developer.s11") }}</th>
              <th>{{ t("page.developer.s56") }}</th>
              <th>{{ t("page.developer.s47") }}</th>
              <th class="right">
                {{ t("page.developer.s21") }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="bot in bots"
              :key="bot.id"
            >
              <td>
                <div class="b-name">
                  {{ bot.name }}
                </div>
                <div class="b-id">
                  {{ bot.id }}
                </div>
              </td>
              <td>
                <span class="badge outline mono">{{ bot.platform }}</span>
              </td>
              <td>{{ bot.kbName ?? bot.kbId }}</td>
              <td class="right ops">
                <el-switch
                  :model-value="bot.active"
                  @change="() => toggleBot(bot)"
                />
                <el-button
                  size="small"
                  text
                  type="danger"
                  :icon="Delete"
                  @click="removeBot(bot.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Chrome 扩展 -->
    <div class="card">
      <h3 class="card-title">
        <el-icon
          :size="14"
          class="title-ico"
        >
          <Setting />
        </el-icon>
        {{ t("page.developer.s61") }}
      </h3>
      <p class="card-desc">
        {{ t("page.developer.s62") }}
      </p>
      <p class="hint">
        {{ t("page.developer.s63") }}
      </p>
    </div>

    <!-- n8n / Zapier -->
    <div class="card">
      <h3 class="card-title">
        <el-icon
          :size="14"
          class="title-ico"
        >
          <RefreshRight />
        </el-icon>
        {{ t("page.developer.s64") }}
      </h3>
      <p class="card-desc">
        {{ t("page.developer.s65") }}
      </p>
      <div class="body">
        <div class="snippet">
          <p class="snippet-label">
            {{ t("page.developer.s69") }}
          </p>
          <pre class="code">{{ t("page.developer.s70") }}</pre>
        </div>
        <p class="hint">
          {{ t("page.developer.s66") }}
        </p>
      </div>
    </div>

    <!-- Notion / Confluence 同步 -->
    <div class="card">
      <h3 class="card-title">
        <el-icon
          :size="14"
          class="title-ico"
        >
          <RefreshRight />
        </el-icon>
        {{ t("page.developer.s81") }}
      </h3>
      <p class="card-desc">
        {{ t("page.developer.s82") }}
      </p>
      <div class="body">
        <div class="grid2">
          <div>
            <label class="lbl">{{ t("page.developer.s47") }}</label>
            <el-select
              v-model="syncKb"
              :placeholder="t('page.developer.s48')"
            >
              <el-option
                v-for="kb in kbs"
                :key="kb.id"
                :value="kb.id"
                :label="kb.name"
              />
            </el-select>
          </div>
          <div>
            <label class="lbl">Notion</label>
            <el-input
              v-model="notionDb"
              :placeholder="t('page.developer.s84')"
            />
          </div>
        </div>
        <div class="grid2 sync-row">
          <div>
            <label class="lbl">Confluence</label>
            <el-input
              v-model="confSpace"
              :placeholder="t('page.developer.s85')"
            />
          </div>
          <div class="sync-btns">
            <el-button
              size="small"
              class="grow"
              :disabled="syncing !== null"
              @click="doSync('notion')"
            >
              <el-icon
                v-if="syncing === 'notion'"
                class="is-loading"
              >
                <Loading />
              </el-icon>
              <el-icon
                v-else
              >
                <Download />
              </el-icon>
              {{ t("page.developer.s83") }} Notion
            </el-button>
            <el-button
              size="small"
              class="grow"
              :disabled="syncing !== null"
              @click="doSync('confluence')"
            >
              <el-icon
                v-if="syncing === 'confluence'"
                class="is-loading"
              >
                <Loading />
              </el-icon>
              <el-icon
                v-else
              >
                <Download />
              </el-icon>
              {{ t("page.developer.s83") }} Confluence
            </el-button>
          </div>
        </div>
        <p
          v-if="syncResult"
          class="sync-result"
        >
          <span
            v-if="syncResult.error"
            class="err-text"
          >{{ syncResult.error }}</span>
          <span
            v-else
            class="hint"
          >
            {{ syncResult.source === "notion" ? "Notion" : "Confluence" }} {{ t("page.developer.s89") }}：
            {{ t("page.developer.s90") }} {{ syncResult.imported }} / {{ t("page.developer.s91") }} {{ syncResult.skipped }} / {{ t("page.developer.s92") }} {{ syncResult.failed }}
          </span>
        </p>
        <p class="hint">
          {{ t("page.developer.s93") }}
        </p>
      </div>
    </div>

    <!-- 新建机器人对话框 -->
    <el-dialog
      v-model="createOpen"
      :title="t('page.developer.s54')"
      width="420px"
    >
      <p class="dialog-desc">
        {{ t("page.developer.s55") }}
      </p>
      <div class="dialog-form">
        <label class="lbl">{{ t("page.developer.s11") }}</label>
        <el-input
          v-model="botName"
          :placeholder="t('page.developer.s68')"
        />
        <label class="lbl">{{ t("page.developer.s56") }}</label>
        <el-select v-model="botPlatform">
          <el-option
            v-for="p in PLATFORMS"
            :key="p"
            :value="p"
            :label="p"
          />
        </el-select>
        <label class="lbl">{{ t("page.developer.s47") }}</label>
        <el-select
          v-model="botKb"
          :placeholder="t('page.developer.s48')"
        >
          <el-option
            v-for="kb in kbs"
            :key="kb.id"
            :value="kb.id"
            :label="kb.name"
          />
        </el-select>
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
          @click="submitCreateBot"
        >
          {{ t("page.developer.s18") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.integrations {
  display: grid;
  gap: 16px;
}
.card { padding: 20px; border-radius: 16px; }

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
  margin: 4px 0 0 22px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.title-ico {
  color: hsl(var(--primary));
}
.body {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .grid2 {
    grid-template-columns: 1fr 1fr;
  }
}
.lbl {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 500;
}
.snippet {
  position: relative;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.4);
}
.snippet-label {
  margin: 0 0 4px;
  font-size: 12px;
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
.snippet-copy {
  position: absolute;
  top: 8px;
  right: 8px;
}
.hint { font-size: 12px; }

.token-box {
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted) / 0.4);
  font-size: 13px;
}
.token-title {
  margin: 0 0 4px;
  font-weight: 500;
}
.token-code {
  overflow-wrap: break-word;
  font-size: 12px;
}
.token-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.token-url {
  overflow-wrap: break-word;
}
.token-copy {
  margin-top: 8px;
}
.sk { height: 64px; border-radius: 8px; }

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
.b-name {
  font-weight: 500;
}
.b-id {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.badge { font-weight: 500; }

.badge.outline {
  border: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
}
.mono {
  font-family: var(--font-mono, monospace);
}
.sync-row {
  align-items: end;
}
.sync-btns {
  display: flex;
  gap: 8px;
}
.grow {
  flex: 1;
}
.sync-result {
  margin: 0;
  font-size: 13px;
}
.err-text {
  color: hsl(var(--destructive));
}
.ok-text {
  color: hsl(142 71% 40%);
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
</style>
