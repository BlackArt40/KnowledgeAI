<script setup lang="ts">
// OpenAPI 文档页（V5，复刻 src/app/docs/page.tsx）：独立无壳页（不在
// AppShell 组），顶栏 + Swagger UI 渲染 /api/openapi.json（Authorize 支持
// kai_sk_ API Key 或会话 JWT）。swagger-ui-dist 资产从 /vendor/swagger-ui
// 加载（单源：生产网关兜底到 Next public/，开发 vite proxy）。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { mountSwaggerUi } from "@/lib/swagger";

const { t } = useTranslation();
const swaggerEl = ref<HTMLElement | null>(null);
let cleanup: (() => void) | null = null;

onMounted(() => {
  if (swaggerEl.value) {
    cleanup = mountSwaggerUi(swaggerEl.value, "/api/openapi.json");
  }
});

onBeforeUnmount(() => {
  if (cleanup) cleanup();
});
</script>

<template>
  <div class="docs-page">
    <header class="docs-head">
      <div class="docs-head-inner">
        <div class="brand">
          <span class="brand-name">KnowledgeAI</span>
          <span class="brand-badge">{{ t("page.docs.s0") }}</span>
        </div>
        <router-link
          to="/developer"
          class="dev-link"
        >
          {{ t("page.docs.s3") }}
        </router-link>
      </div>
    </header>
    <main class="docs-main">
      <!-- 页面自有的标题与替代路径：Swagger UI 内部 DOM 由第三方渲染，
           我们只能保证「外围」可读（文档大纲、区域可访问名、JSON 下载兜底） -->
      <div class="docs-intro">
        <h1 class="docs-title">
          {{ t("page.docs.s4") }}
        </h1>
        <p class="docs-desc">
          {{ t("page.docs.s5") }}
        </p>
        <a
          class="docs-json"
          href="/api/openapi.json"
          download
        >{{ t("page.docs.s7") }}</a>
      </div>
      <!-- Swagger UI 渲染容器（bundle 挂载到裸 div） -->
      <div
        id="kai-swagger-ui"
        ref="swaggerEl"
        class="swagger"
        role="region"
        :aria-label="t('page.docs.s6')"
      />
    </main>
  </div>
</template>

<style scoped>
.docs-page {
  min-height: 100dvh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.docs-head {
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--card) / 0.6);
}
.docs-head-inner {
  display: flex;
  max-width: 72rem;
  align-items: center;
  justify-content: space-between;
  margin: 0 auto;
  padding: 12px 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-name {
  font-size: 17px;
  font-weight: 600;
}
.brand-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: hsl(var(--primary) / 0.1);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.dev-link {
  font-size: 13px;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.dev-link:hover {
  color: hsl(var(--foreground));
  text-decoration: underline;
}
.docs-main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 24px 16px;
}
.docs-intro {
  margin-bottom: 16px;
}
.docs-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.docs-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
}
.docs-json {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
  color: hsl(var(--primary));
}
.swagger {
  min-height: 70vh;
  width: 100%;
}
</style>
