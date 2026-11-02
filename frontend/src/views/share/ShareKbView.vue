<script setup lang="ts">
// 知识库公开分享页（共享与分发，令牌即凭据）：GET /api/share/kb/[token]。
// 密码经 x-share-password 头传递；错误码 → UI：needPassword(401)/expired(410)/
// exhausted(403)/notFound(404)。文档正文按需拉取（?doc=id），不额外消耗次数。
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { ArrowLeft, Clock, Collection, Hide, Link as LinkIcon, Lock } from "@element-plus/icons-vue";
import { fetchSharedKb, type SharedKb, type ShareErrorCode } from "@/api/share";
import { ApiError } from "@/api/client";
import { formatRelative, formatSize } from "@shared/format";

const { t } = useTranslation();
const route = useRoute();
const token = String(route.params.token ?? "");

const data = ref<SharedKb | null>(null);
const errorCode = ref<ShareErrorCode | null>(null);
const pwd = ref("");
const pwdError = ref(false);
const loading = ref(true);
/** 已通过密码门的密码：按需拉取文档预览时要复用 */
const unlockedPassword = ref<string | undefined>(undefined);

async function fetchPublic(pwd?: string) {
  loading.value = true;
  errorCode.value = null;
  try {
    data.value = await fetchSharedKb(token, pwd);
    unlockedPassword.value = pwd;
  } catch (e) {
    errorCode.value = e instanceof ApiError ? ((e.code as ShareErrorCode) ?? "notFound") : "notFound";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void fetchPublic();
});

async function submitPassword() {
  pwdError.value = false;
  try {
    data.value = await fetchSharedKb(token, pwd.value);
    unlockedPassword.value = pwd.value;
    errorCode.value = null;
  } catch (e) {
    const err = e as { status?: number; code?: string };
    if (err.status === 401) pwdError.value = true;
    else errorCode.value = (err.code as ShareErrorCode) ?? "notFound";
  }
}

// ── 文档预览（按需拉取，失败不影响列表）──────────────────────────────────
const activeId = ref<string | null>(null);
const preview = ref<{ id: string; name: string; content: string } | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

async function toggleDoc(id: string) {
  if (activeId.value === id) {
    activeId.value = null;
    preview.value = null;
    previewError.value = null;
    return;
  }
  activeId.value = id;
  preview.value = null;
  previewError.value = null;
  previewLoading.value = true;
  try {
    const d = await fetchSharedKb(token, unlockedPassword.value, id);
    preview.value = d.doc
      ? { id: d.doc.id, name: d.doc.name, content: d.doc.content }
      : null;
  } catch (e) {
    previewError.value = e instanceof ApiError && e.message ? e.message : t("common.requestFailed");
  } finally {
    previewLoading.value = false;
  }
}

type HardError = Exclude<ShareErrorCode, "needPassword">;
const errorUi: Record<HardError, { icon: typeof Clock }> = {
  expired: { icon: Clock },
  exhausted: { icon: Hide },
  notFound: { icon: LinkIcon },
};
const errorTitles: Record<HardError, string> = {
  expired: "page.share-kb.s20",
  exhausted: "page.share-kb.s22",
  notFound: "page.share-kb.s24",
};
const errorDescs: Record<HardError, string> = {
  expired: "page.share-kb.s21",
  exhausted: "page.share-kb.s23",
  notFound: "page.share-kb.s25",
};
</script>

<template>
  <!-- loading -->
  <div
    v-if="loading"
    class="center"
  >
    <div class="spinner" />
  </div>

  <!-- 硬错误（expired/exhausted/notFound） -->
  <div
    v-else-if="errorCode && errorCode !== 'needPassword'"
    class="center"
  >
    <div class="icon-badge">
      <el-icon :size="26">
        <component :is="errorUi[errorCode as HardError].icon" />
      </el-icon>
    </div>
    <h1>{{ t(errorTitles[errorCode as HardError]) }}</h1>
    <p class="desc">
      {{ t(errorDescs[errorCode as HardError]) }}
    </p>
    <el-button
      tag="a"
      href="/"
    >
      <el-icon><ArrowLeft /></el-icon>{{ t("page.share-kb.s12") }}
    </el-button>
  </div>

  <!-- 密码门 -->
  <div
    v-else-if="errorCode === 'needPassword' || !data"
    class="center"
  >
    <div class="icon-badge">
      <el-icon :size="26">
        <Lock />
      </el-icon>
    </div>
    <h1>{{ t("page.share-kb.s1") }}</h1>
    <p class="desc">
      {{ t("page.share-kb.s0") }}
    </p>
    <form
      class="pwd-form"
      @submit.prevent="submitPassword"
    >
      <el-input
        id="share-password"
        v-model="pwd"
        type="password"
        :placeholder="t('page.share-kb.s13')"
        autofocus
      />
      <p
        v-if="pwdError"
        class="pwd-error"
      >
        {{ t("page.share-kb.s10") }}
      </p>
      <el-button
        type="primary"
        native-type="submit"
      >
        {{ t("page.share-kb.s11") }}
      </el-button>
    </form>
  </div>

  <!-- 知识库内容 -->
  <div
    v-else
    class="kb-page"
  >
    <div class="kb-in">
      <div class="meta-row">
        <el-icon :size="14">
          <Collection />
        </el-icon>
        <span>{{ t("page.share-kb.s9") }}</span>
        <span class="views">{{ t("page.share-kb.s3", { count: data.views }) }}</span>
      </div>

      <header class="kb-head">
        <span class="kb-avatar">{{ data.kb.initial || data.kb.name.charAt(0) }}</span>
        <div class="kb-title">
          <h1>{{ data.kb.name }}</h1>
          <p
            v-if="data.kb.desc"
            class="kb-desc"
          >
            {{ data.kb.desc }}
          </p>
          <p class="kb-meta">
            {{ t("page.share-kb.s2", { count: data.docs.length }) }}
            <template v-if="data.maxViews !== null">
              · {{ t("page.share-kb.s4", { views: data.views, max: data.maxViews }) }}
            </template>
            <template v-if="data.expiresAt">
              · {{ t("page.share-kb.s18", { date: new Date(data.expiresAt).toLocaleDateString() }) }}
            </template>
          </p>
        </div>
      </header>

      <div class="card card-body">
        <div
          v-if="data.docs.length === 0"
          class="empty"
        >
          {{ t("page.share-kb.s5") }}
        </div>
        <div
          v-for="d in data.docs"
          :key="d.id"
          class="doc-item"
        >
          <button
            type="button"
            class="doc-head"
            :aria-expanded="activeId === d.id"
            @click="toggleDoc(d.id)"
          >
            <span class="doc-main">
              <span class="doc-name">{{ d.name }}</span>
              <span class="doc-meta">
                {{ d.type === "web" ? t("page.share-kb.s14") : formatSize(d.size) }}
                · {{ formatRelative(d.uploadedAt) }}
                <template v-if="d.snippet"> · {{ d.snippet }}</template>
              </span>
            </span>
            <span class="doc-action">{{ activeId === d.id ? t("page.share-kb.s8") : t("page.share-kb.s7") }}</span>
          </button>
          <div
            v-if="activeId === d.id"
            class="doc-preview"
          >
            <p
              v-if="previewLoading"
              class="hint"
            >
              {{ t("page.share-kb.s6") }}
            </p>
            <p
              v-else-if="previewError"
              class="err"
            >
              {{ previewError }}
            </p>
            <pre
              v-else
              class="doc-content"
            >{{ preview?.content || t("page.share-kb.s15") }}</pre>
          </div>
        </div>
      </div>

      <p class="foot">
        {{ t("page.share-kb.s100") }} · <a
          href="/"
          class="underline"
        >{{ t("page.share-kb.s16") }}</a>
      </p>
    </div>
  </div>
</template>

<style scoped>
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
.spinner {
  height: 32px;
  width: 32px;
  border: 2px solid hsl(var(--primary));
  border-top-color: transparent;
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.icon-badge {
  display: flex;
  height: 64px;
  width: 64px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  color: #fff;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.desc {
  max-width: 28rem;
  margin: 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.pwd-form {
  display: flex;
  width: 100%;
  max-width: 20rem;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.pwd-error {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--destructive));
}
.kb-page {
  min-height: 100dvh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.kb-in {
  max-width: 56rem;
  margin: 0 auto;
  padding: 40px 16px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.views {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: hsl(var(--muted));
}
.kb-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin: 16px 0 20px;
}
.kb-avatar {
  display: flex;
  height: 44px;
  width: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
}
.kb-title {
  min-width: 0;
}
.kb-title h1 {
  word-break: break-word;
}
.kb-desc {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.kb-meta {
  margin: 6px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.doc-item {
  border-bottom: 1px solid hsl(var(--border));
}
.doc-item:last-child {
  border-bottom: 0;
}
.doc-head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.doc-head:hover .doc-name {
  color: hsl(var(--primary));
}
.doc-main {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}
.doc-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-meta {
  overflow: hidden;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-action {
  flex-shrink: 0;
  font-size: 12px;
  color: hsl(var(--primary));
}
.doc-preview {
  padding: 0 0 12px;
}
.doc-content {
  margin: 0;
  max-height: 50vh;
  overflow: auto;
  padding: 14px;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.4);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.err {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}
.foot {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.underline {
  text-decoration: underline;
}
</style>
