<script setup lang="ts">
// (auth) 组布局：左品牌右表单分屏（复刻 Next 的 (auth)/layout.tsx）。
// 品牌 panel 仅 lg+ 显示；slot 为具体表单视图。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import { Check } from "@element-plus/icons-vue";
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
          <div class="capability-list">
            <div
              v-for="item in ['page.features.s12', 'page.features.s4', 'page.features.s9']"
              :key="item"
              class="capability-item"
            >
              <span class="capability-icon">
                <el-icon :size="14"><Check /></el-icon>
              </span>
              <span>{{ t(item) }}</span>
            </div>
          </div>
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
  background: hsl(240 18% 10%);
}
@media (min-width: 1024px) {
  .brand-panel {
    display: block;
  }
}
.brand-grad {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 84% 12%, hsl(var(--primary) / 0.36), transparent 34%),
    radial-gradient(circle at 12% 88%, hsl(var(--brand-to) / 0.14), transparent 32%),
    linear-gradient(150deg, hsl(240 18% 10%), hsl(243 22% 15%));
}
.brand-glow {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: linear-gradient(to bottom right, black, transparent 72%);
  pointer-events: none;
}
.brand-body {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px clamp(40px, 5vw, 72px);
  color: #fff;
}
.brand-copy {
  max-width: 36rem;
  margin: auto 0;
  padding: 64px 0;
}
.brand-copy h2 {
  margin: 0;
  font-size: clamp(32px, 2.8vw, 42px);
  font-weight: 650;
  line-height: 1.18;
  letter-spacing: -0.045em;
  text-wrap: balance;
}
.brand-copy > p {
  max-width: 28rem;
  margin: 22px 0 0;
  font-size: 15px;
  line-height: 1.75;
  color: rgb(255 255 255 / 0.66);
}
.capability-list {
  display: grid;
  gap: 12px;
  margin-top: 40px;
}
.capability-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: rgb(255 255 255 / 0.88);
}
.capability-icon {
  display: inline-flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 9px;
  background: rgb(255 255 255 / 0.07);
  color: hsl(152 55% 65%);
}
.copyright {
  margin: 0;
  font-size: 12px;
  color: rgb(255 255 255 / 0.46);
}

/* Form panel */
.form-panel {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  background:
    radial-gradient(circle at 100% 0%, hsl(var(--primary) / 0.045), transparent 28%),
    hsl(var(--background));
}
.panel-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 32px;
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
