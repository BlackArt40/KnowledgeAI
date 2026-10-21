<script setup lang="ts">
// (auth) 组布局：左品牌右表单分屏（复刻 Next 的 (auth)/layout.tsx）。
// 品牌 panel 仅 lg+ 显示；slot 为具体表单视图。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import AppLogo from "@/components/AppLogo.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";

const { t } = useTranslation();
const year = computed(() => new Date().getFullYear());
</script>

<template>
  <div class="auth-shell">
    <!-- Brand panel -->
    <aside class="brand-panel">
      <div class="brand-grad" />
      <div class="brand-glow" />
      <div class="brand-body">
        <AppLogo light />
        <div class="brand-copy">
          <h2>
            {{ t("page.auth-layout.s1") }}<br>
            {{ t("page.auth-layout.s2") }}
          </h2>
          <p>{{ t("page.auth-layout.s3") }}</p>
          <figure>
            <blockquote>{{ t("page.auth-layout.s4") }}</blockquote>
            <figcaption>
              <span class="avatar">{{ t("page.auth-layout.s5") }}</span>
              <span class="who">{{ t("page.auth-layout.s6") }}</span>
            </figcaption>
          </figure>
        </div>
        <p class="copyright">
          © {{ year }} KnowledgeAI · {{ t("page.auth-layout.s7") }}
        </p>
      </div>
    </aside>

    <!-- Form panel -->
    <div class="form-panel">
      <div class="panel-top">
        <a
          href="/"
          class="mobile-home"
        >{{ t("page.auth-layout.s0") }}</a>
        <div class="spacer" />
        <ThemeToggle />
      </div>
      <div class="panel-center">
        <div class="form-box">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: 1fr;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  overflow-x: clip;
}
/* grid 子项默认 min-width:auto，窄屏会被表单最小内容撑出 9px 横向滚动 */
.auth-shell > * {
  min-width: 0;
}
@media (min-width: 1024px) {
  .auth-shell {
    grid-template-columns: 1fr 1fr;
  }
}

/* Brand panel（lg+） */
.brand-panel {
  position: relative;
  display: none;
  overflow: hidden;
  background: hsl(var(--card));
}
@media (min-width: 1024px) {
  .brand-panel {
    display: block;
  }
}
.brand-grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-via)), hsl(var(--brand-to)));
}
.brand-glow {
  position: absolute;
  bottom: -96px;
  left: -64px;
  height: 288px;
  width: 288px;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.1);
  filter: blur(48px);
  pointer-events: none;
}
.brand-body {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: 40px;
  color: #fff;
}
.brand-copy {
  max-width: 28rem;
}
.brand-copy h2 {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.25;
  text-wrap: balance;
  margin: 0;
}
.brand-copy p {
  margin-top: 16px;
  font-size: 14px;
  color: rgb(255 255 255 / 0.8);
}
figure {
  margin: 40px 0 0;
  padding: 20px;
  border: 1px solid rgb(255 255 255 / 0.15);
  background: rgb(255 255 255 / 0.1);
  border-radius: 16px;
  backdrop-filter: blur(8px);
}
blockquote {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgb(255 255 255 / 0.9);
}
figcaption {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.avatar {
  display: flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.2);
  font-size: 12px;
  font-weight: 600;
}
.who {
  font-size: 12px;
  color: rgb(255 255 255 / 0.8);
}
.copyright {
  margin: 0;
  font-size: 12px;
  color: rgb(255 255 255 / 0.6);
}

/* Form panel */
.form-panel {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.panel-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
}
.mobile-home {
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}
.mobile-home:hover {
  color: hsl(var(--foreground));
}
.spacer {
  margin-left: auto;
}
.panel-center {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 0 20px 48px;
}
.form-box {
  width: 100%;
  max-width: 24rem;
}
</style>
