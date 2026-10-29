<script setup lang="ts">
// 服务条款（静态，全部文案走 page.terms.* i18n key，与 Next 版逐字一致）。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import { Document, Wallet, WarningFilled, Reading, Lock } from "@element-plus/icons-vue";
import AppLogo from "@/components/AppLogo.vue";

const { t } = useTranslation();

const sections = computed(() => [
  { icon: Reading, title: t("page.terms.s4"), body: [t("page.terms.s5"), t("page.terms.s6")] },
  { icon: Wallet, title: t("page.terms.s7"), body: [t("page.terms.s8"), t("page.terms.s9")] },
  { icon: WarningFilled, title: t("page.terms.s10"), body: [t("page.terms.s11"), t("page.terms.s12"), t("page.terms.s13")] },
  { icon: Document, title: t("page.terms.s14"), body: [t("page.terms.s15"), t("page.terms.s16")] },
  { icon: Lock, title: t("page.terms.s17"), body: [t("page.terms.s18"), t("page.terms.s19")] },
]);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="header-in">
        <AppLogo />
        <a
          href="/"
          class="back"
        >{{ t("page.terms.s0") }}</a>
      </div>
    </header>

    <article class="article">
      <div class="title-block">
        <h1>{{ t("page.terms.s1") }}</h1>
        <p>{{ t("page.terms.s20") }}</p>
      </div>

      <div class="highlight warn">
        <p class="highlight-title">
          {{ t("page.terms.s2") }}
        </p>
        <p class="highlight-body">
          {{ t("page.terms.s21") }}
        </p>
      </div>

      <div class="sections">
        <section
          v-for="s in sections"
          :key="s.title"
        >
          <h2>
            <el-icon
              :size="18"
              color="hsl(var(--primary))"
            >
              <component :is="s.icon" />
            </el-icon>
            {{ s.title }}
          </h2>
          <div class="body">
            <p
              v-for="(p, i) in s.body"
              :key="i"
            >
              {{ p }}
            </p>
          </div>
        </section>
      </div>

      <div class="footer-box">
        <p class="footer-title">
          {{ t("page.terms.s3") }}
        </p>
        <p class="footer-body">
          {{ t("page.terms.s22") }}
          <a
            href="mailto:support@knowledgeai.dev"
            class="primary-link"
          > support@knowledgeai.dev</a>
        </p>
      </div>
    </article>
  </div>
</template>

<style scoped>
.page {
  min-height: 100dvh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.page-header {
  border-bottom: 1px solid hsl(var(--border));
}
.header-in {
  display: flex;
  max-width: 48rem;
  margin: 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
}
.back {
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}
.back:hover {
  color: hsl(var(--foreground));
}
.article {
  max-width: 48rem;
  margin: 0 auto;
  padding: 48px 16px;
}
.title-block {
  padding-bottom: 32px;
  border-bottom: 1px solid hsl(var(--border));
}
.title-block h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.title-block p {
  margin: 8px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.highlight {
  margin-top: 32px;
  padding: 16px;
  font-size: 14px;
  border-radius: var(--radius);
}
.highlight.warn {
  border: 1px solid hsl(var(--warning) / 0.3);
  background: hsl(var(--warning) / 0.05);
}
.highlight-title {
  margin: 0;
  font-weight: 500;
  color: hsl(var(--warning));
}
.highlight-body {
  margin: 4px 0 0;
  color: hsl(var(--muted-foreground));
}
.sections {
  margin-top: 40px;
  display: grid;
  gap: 40px;
}
section h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.body {
  margin-top: 12px;
  display: grid;
  gap: 12px;
}
.body p {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: hsl(var(--muted-foreground));
}
.footer-box {
  margin-top: 48px;
  padding: 20px;
  font-size: 14px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.5);
  border-radius: var(--radius);
}
.footer-title {
  margin: 0;
  font-weight: 500;
}
.footer-body {
  margin: 4px 0 0;
  color: hsl(var(--muted-foreground));
}
.primary-link {
  color: hsl(var(--primary));
}
</style>
