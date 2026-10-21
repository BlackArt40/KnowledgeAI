<script setup lang="ts">
// 404 兜底：V0 起前端全部路由都有归宿；网关切流后未迁移路径仍由 Next 兜底，
// 这里只覆盖 Vue 已接管的未知路径。文案走 i18n（与 page.not-found 同名空间）。
import { useTranslation } from "i18next-vue";
import AppLogo from "@/components/AppLogo.vue";

const { t } = useTranslation();
</script>

<template>
  <main class="nf">
    <div class="glow" />
    <div class="inner">
      <AppLogo />
      <p class="code">
        404
      </p>
      <h1>{{ t("page.not-found.s0") }}</h1>
      <p class="desc">
        {{ t("page.not-found.s3") }}
      </p>
      <div class="actions">
        <router-link
          to="/"
          class="btn primary"
        >
          {{ t("page.not-found.s1") }}
        </router-link>
        <router-link
          to="/knowledge-base"
          class="btn outline"
        >
          {{ t("page.not-found.s2") }}
        </router-link>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nf {
  position: relative;
  display: flex;
  min-height: 100dvh;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  overflow: hidden;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.glow {
  position: absolute;
  inset: 0 0 auto;
  height: 420px;
  background: radial-gradient(60% 100% at 50% 0%, hsl(var(--brand-from) / 0.14), transparent 70%);
  pointer-events: none;
}
.inner {
  position: relative;
  display: flex;
  max-width: 28rem;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.code {
  margin: 28px 0 0;
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
h1 {
  margin: 12px 0 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.desc {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 28px;
}
.btn {
  display: inline-flex;
  height: 38px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.btn.primary {
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.btn.outline {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
}
.btn.outline:hover {
  background: hsl(var(--accent));
}
</style>
