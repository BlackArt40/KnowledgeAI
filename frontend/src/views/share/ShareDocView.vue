<script setup lang="ts">
// 文档分享公开页（P4-2，令牌即凭据）：GET /api/share/doc/[token]?password=…
// 错误码 → UI：needPassword(401)/expired(410)/exhausted(403)/notFound(404)。
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Document as DocIcon, Lock, Clock, Hide, Link as LinkIcon, ArrowLeft } from "@element-plus/icons-vue";
import { fetchSharedDoc, type SharedDoc, type ShareErrorCode } from "@/api/share";
import { ApiError } from "@/api/client";
import { formatSize, formatRelative } from "@shared/format";

const { t } = useTranslation();
const route = useRoute();
const token = String(route.params.token ?? "");

const data = ref<SharedDoc | null>(null);
const errorCode = ref<ShareErrorCode | null>(null);
const pwd = ref("");
const pwdError = ref(false);
const loading = ref(true);

async function fetchPublic(password?: string) {
  loading.value = true;
  errorCode.value = null;
  try {
    data.value = await fetchSharedDoc(token, password);
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
    data.value = await fetchSharedDoc(token, pwd.value);
    errorCode.value = null;
  } catch (e) {
    const err = e as { status?: number; code?: string };
    if (err.status === 401) pwdError.value = true;
    else errorCode.value = (err.code as ShareErrorCode) ?? "notFound";
  }
}

const errorUi: Record<Exclude<ShareErrorCode, "needPassword">, { icon: typeof Clock }> = {
  expired: { icon: Clock },
  exhausted: { icon: Hide },
  notFound: { icon: LinkIcon },
};
const errorTitles: Record<Exclude<ShareErrorCode, "needPassword">, string> = {
  expired: "page.share-doc.s7",
  exhausted: "page.share-doc.s9",
  notFound: "page.share-doc.s11",
};
const errorDescs: Record<Exclude<ShareErrorCode, "needPassword">, string> = {
  expired: "page.share-doc.s8",
  exhausted: "page.share-doc.s10",
  notFound: "page.share-doc.s12",
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
        <component :is="errorUi[errorCode as Exclude<ShareErrorCode,'needPassword'>].icon" />
      </el-icon>
    </div>
    <h1>{{ t(errorTitles[errorCode as Exclude<ShareErrorCode,'needPassword'>]) }}</h1>
    <p class="desc">
      {{ t(errorDescs[errorCode as Exclude<ShareErrorCode,'needPassword'>]) }}
    </p>
    <el-button
      tag="a"
      href="/"
    >
      <el-icon><ArrowLeft /></el-icon>{{ t("page.share-doc.s0") }}
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
    <h1>{{ t("page.share-doc.s1") }}</h1>
    <p class="desc">
      {{ t("page.share-doc.s17") }}
    </p>
    <form
      class="pwd-form"
      @submit.prevent="submitPassword"
    >
      <el-input
        id="share-password"
        v-model="pwd"
        type="password"
        :placeholder="t('page.share-doc.s13')"
        autofocus
      />
      <p
        v-if="pwdError"
        class="pwd-error"
      >
        {{ t("page.share-doc.s2") }}
      </p>
      <el-button
        type="primary"
        native-type="submit"
      >
        {{ t("page.share-doc.s3") }}
      </el-button>
    </form>
  </div>

  <!-- 文档内容 -->
  <div
    v-else
    class="doc-page"
  >
    <div class="doc-in">
      <div class="meta-row">
        <el-icon :size="14">
          <DocIcon />
        </el-icon>
        <span>{{ t("page.share-doc.s4") }}</span>
        <span class="views">
          {{ t("page.share-doc.s18", { count: data!.views }) }}{{ data!.maxViews ? ` / ${data!.maxViews}` : "" }}
        </span>
      </div>

      <div class="doc-card">
        <h1>{{ data!.name }}</h1>
        <p class="doc-meta">
          {{ data!.type === "web" ? t("page.share-doc.s14") : formatSize(data!.size) }}
          · {{ t("page.share-doc.s19", { time: formatRelative(data!.uploadedAt) }) }}
          <template v-if="data!.expiresAt">
            · {{ t("page.share-doc.s16", { date: new Date(data!.expiresAt).toLocaleDateString() }) }}
          </template>
        </p>
        <pre class="doc-content">{{ data!.content || t("page.share-doc.s15") }}</pre>
      </div>

      <p class="foot">
        {{ t("page.share-doc.s20") }} · <a
          href="/"
          class="underline"
        >{{ t("page.share-doc.s5") }}</a>
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
  border-radius: 9999px;
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
  border-radius: 16px;
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
.doc-page {
  min-height: 100dvh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.doc-in {
  max-width: 48rem;
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
  border-radius: 9999px;
  background: hsl(var(--muted));
  font-weight: 400;
}
.doc-card {
  margin-top: 16px;
  padding: 24px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: 16px;
}
.doc-card h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  word-break: break-all;
}
.doc-meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.doc-content {
  margin: 20px 0 0;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.8;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.4);
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
