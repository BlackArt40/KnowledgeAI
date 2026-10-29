<script setup lang="ts">
// 隐私政策（静态，全部文案走 page.privacy.* i18n key，与 Next 版逐字一致）。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import { Lock, DataLine, View, Document, Coffee, Delete } from "@element-plus/icons-vue";
import AppLogo from "@/components/AppLogo.vue";

const { t } = useTranslation();

const sections = computed(() => [
  { icon: DataLine, title: t("page.privacy.s4"), body: [t("page.privacy.s5"), t("page.privacy.s6")] },
  { icon: View, title: t("page.privacy.s7"), body: [t("page.privacy.s8"), t("page.privacy.s9")] },
  { icon: Lock, title: t("page.privacy.s10"), body: [t("page.privacy.s11"), t("page.privacy.s12")] },
  { icon: Document, title: t("page.privacy.s13"), body: [t("page.privacy.s14"), t("page.privacy.s15")] },
  { icon: Coffee, title: t("page.privacy.s16"), body: [t("page.privacy.s17"), t("page.privacy.s18")] },
  { icon: Delete, title: t("page.privacy.s19"), body: [t("page.privacy.s20")] },
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
        >{{ t("page.privacy.s0") }}</a>
      </div>
    </header>

    <article class="article">
      <div class="title-block">
        <h1>{{ t("page.privacy.s1") }}</h1>
        <p>{{ t("page.privacy.s21") }}</p>
      </div>

      <div class="highlight primary">
        <p class="highlight-title">
          {{ t("page.privacy.s2") }}
        </p>
        <p class="highlight-body">
          {{ t("page.privacy.s22") }}
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
          {{ t("page.privacy.s3") }}
        </p>
        <p class="footer-body">
          {{ t("page.privacy.s23") }}
          <a
            href="mailto:privacy@knowledgeai.dev"
            class="primary-link"
          > privacy@knowledgeai.dev</a>
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
.highlight.primary {
  border: 1px solid hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.05);
}
.highlight-title {
  margin: 0;
  font-weight: 500;
  color: hsl(var(--primary));
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
