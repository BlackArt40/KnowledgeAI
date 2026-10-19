<script setup lang="ts">
// Agent 报告分享公开页（/r/[id]）：GET /api/agent/public/[id]，密码经
// x-share-password 头。错误码：needPassword/expired/exhausted/disabled/其他。
// 报告正文 markdown 渲染（markdown-it，html:false 防 XSS）+ 引用与评论列表 +
// 复制 / 下载 MD / 打印 PDF。
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Lock, ArrowLeft, CopyDocument, Check, Download, Clock } from "@element-plus/icons-vue";
import MarkdownIt from "markdown-it";
import { fetchSharedReport, type SharedReport } from "@/api/share";
import { ApiError } from "@/api/client";
import { formatRelative } from "@shared/format";

const { t } = useTranslation();
const route = useRoute();
const id = String(route.params.id ?? "");

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const data = ref<SharedReport | null>(null);
const error = ref<string | null>(null);
const errorCode = ref<string | null>(null);
const loading = ref(true);
const password = ref("");
const pwdError = ref(false);
const copied = ref(false);

async function fetchPublic(pwd?: string) {
  loading.value = true;
  try {
    data.value = await fetchSharedReport(id, pwd);
    error.value = null;
    errorCode.value = null;
    pwdError.value = false;
  } catch (e) {
    data.value = null;
    if (e instanceof ApiError) {
      error.value = e.message ?? null;
      errorCode.value = e.code ?? null;
      if (e.code === "needPassword" && pwd) pwdError.value = true;
    } else {
      error.value = t("page.report-share.s9");
      errorCode.value = null;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void fetchPublic();
});

const reportHtml = computed(() => (data.value ? md.render(data.value.report) : ""));

function copyReport() {
  if (!data.value?.report) return;
  void navigator.clipboard?.writeText(data.value.report);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function downloadMd() {
  if (!data.value?.report) return;
  const blob = new Blob([data.value.report], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.value.topic}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function printReport() {
  window.print();
}
</script>

<template>
  <!-- loading -->
  <div
    v-if="loading"
    class="wrap"
  >
    <div class="skeleton" />
    <div class="skeleton tall" />
  </div>

  <!-- 密码门 -->
  <div
    v-else-if="errorCode === 'needPassword'"
    class="center"
  >
    <div class="icon-badge plain">
      <el-icon :size="26">
        <Lock />
      </el-icon>
    </div>
    <h1>{{ t("page.report-share.s0") }}</h1>
    <p class="desc">
      {{ t("page.report-share.s1") }}
    </p>
    <p
      v-if="pwdError"
      class="pwd-error"
    >
      {{ t("page.report-share.s2") }}
    </p>
    <form
      class="pwd-form"
      @submit.prevent="fetchPublic(password)"
    >
      <el-input
        id="report-password"
        v-model="password"
        type="password"
        :placeholder="t('page.report-share.s10')"
        autofocus
      />
      <el-button
        type="primary"
        native-type="submit"
      >
        {{ t("page.report-share.s3") }}
      </el-button>
    </form>
    <el-button
      text
      size="small"
      tag="a"
      href="/"
    >
      <el-icon><ArrowLeft /></el-icon>{{ t("page.report-share.s4") }}
    </el-button>
  </div>

  <!-- 硬错误 -->
  <div
    v-else-if="error"
    class="center"
  >
    <span class="err-icon">
      {{ errorCode === "expired" ? "⏰" : errorCode === "exhausted" ? "🔒" : errorCode === "disabled" ? "🚫" : "📭" }}
    </span>
    <h1>{{ error }}</h1>
    <p class="desc">
      {{
        errorCode === "expired" ? t("page.report-share.s11")
        : errorCode === "exhausted" ? t("page.report-share.s12")
          : errorCode === "disabled" ? t("page.report-share.s13")
            : t("page.report-share.s14")
      }}
    </p>
    <el-button
      tag="a"
      href="/"
    >
      <el-icon><ArrowLeft /></el-icon>{{ t("page.report-share.s4") }}
    </el-button>
  </div>

  <!-- 报告内容 -->
  <div
    v-else-if="data"
    class="wrap"
  >
    <div class="top-row">
      <el-button
        text
        size="small"
        tag="a"
        href="/"
      >
        <el-icon><ArrowLeft /></el-icon>{{ t("page.report-share.s5") }}
      </el-button>
      <div class="badges">
        <span
          v-if="data.protected"
          class="chip"
        ><el-icon :size="11"><Lock /></el-icon>{{ t("page.report-share.s6") }}</span>
        <span class="chip">{{ t("page.report-share.s7") }}</span>
      </div>
    </div>

    <div>
      <h1 class="topic">
        {{ data.topic }}
      </h1>
      <div class="topic-meta">
        <span class="meta-item"><el-icon :size="11"><Clock /></el-icon> {{ formatRelative(data.createdAt) }}</span>
        <span v-if="data.durationMs">{{ t("page.report-share.s15", { sec: (data.durationMs / 1000).toFixed(1) }) }}</span>
        <span v-if="data.views !== undefined && data.views > 0">{{ t("page.report-share.s16", { count: data.views }) }}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>{{ t("page.report-share.s8") }}</h2>
        <div class="card-actions">
          <el-button
            size="small"
            @click="copyReport"
          >
            <el-icon v-if="copied">
              <Check />
            </el-icon><el-icon v-else>
              <CopyDocument />
            </el-icon>
            {{ t("common.copy") }}
          </el-button>
          <el-button
            size="small"
            @click="downloadMd"
          >
            <el-icon><Download /></el-icon> MD
          </el-button>
          <el-button
            size="small"
            type="primary"
            @click="printReport"
          >
            PDF
          </el-button>
        </div>
      </div>
      <!-- markdown-it html:false 关闭原始 HTML（XSS 防线在此，规则于 eslint 配置豁免） -->
      <div
        class="report"
        v-html="reportHtml"
      />
    </div>

    <div
      v-if="data.citations.length > 0"
      class="card slim"
    >
      <h3>{{ t("page.report-share.s17", { count: data.citations.length }) }}</h3>
      <div class="cites">
        <div
          v-for="c in data.citations"
          :key="c.n"
          class="cite"
        >
          <div class="cite-head">
            <span class="cite-n">{{ c.n }}</span>
            <span class="cite-title">{{ c.title }}</span>
          </div>
          <p class="cite-snippet">
            {{ c.snippet }}
          </p>
          <span class="cite-source">{{ c.source }}</span>
        </div>
      </div>
    </div>

    <div
      v-if="data.comments && data.comments.length > 0"
      class="card slim"
    >
      <h3>{{ t("page.report-share.s18", { count: data.comments.length }) }}</h3>
      <div class="cites">
        <div
          v-for="c in data.comments"
          :key="c.id"
          class="cite"
          :class="{ reply: c.parentId }"
        >
          <div class="cite-head">
            <span class="avatar">{{ (c.userName || "?").charAt(0).toUpperCase() }}</span>
            <span class="cite-title">{{ c.userName }}</span>
            <span
              v-if="c.citeN !== undefined"
              class="chip mini"
            >{{ t("page.report-share.s19", { n: c.citeN }) }}</span>
            <span class="cite-time">{{ formatRelative(c.createdAt) }}</span>
          </div>
          <p class="cite-snippet">
            {{ c.text }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 48rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
  padding: 24px 16px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  min-height: 100dvh;
}
.center {
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.skeleton {
  height: 48px;
  border-radius: 12px;
  background: hsl(var(--muted));
  animation: pulse 1.5s ease-in-out infinite;
}
.skeleton.tall {
  height: 384px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.icon-badge {
  display: flex;
  height: 56px;
  width: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
}
.icon-badge.plain {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.err-icon {
  font-size: 36px;
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.desc {
  margin: 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.pwd-error {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--destructive));
}
.pwd-form {
  display: flex;
  width: 100%;
  max-width: 20rem;
  gap: 8px;
}
.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.badges {
  display: flex;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.chip.mini {
  padding: 1px 5px;
  font-size: 9px;
}
.topic {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.topic-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.card {
  padding: 24px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 16px;
}
.card.slim {
  padding: 16px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.card-head h2,
.card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.card-actions {
  display: flex;
  gap: 6px;
}
.report {
  font-size: 14px;
  line-height: 1.8;
}
.report :deep(h1),
.report :deep(h2),
.report :deep(h3) {
  margin: 20px 0 8px;
}
.report :deep(p) {
  margin: 8px 0;
}
.report :deep(pre) {
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.5);
  font-size: 13px;
}
.report :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
}
.report :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.report :deep(th),
.report :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 6px 10px;
  text-align: left;
}
.cites {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}
.cite {
  padding: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.cite.reply {
  margin-left: 16px;
  border-left: 2px solid hsl(var(--primary) / 0.3);
}
.cite-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cite-n {
  display: flex;
  height: 16px;
  min-width: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.avatar {
  display: flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.15);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.cite-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.cite-time {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.cite-snippet {
  margin: 4px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.cite-source {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  word-break: break-all;
  color: hsl(var(--muted-foreground));
}
</style>
