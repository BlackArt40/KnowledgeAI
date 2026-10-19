<script setup lang="ts">
// 营销 Hero（V5，复刻 src/components/marketing/hero.tsx）：网格/锥形渐变
// 背景、主标题、双 CTA（注册 / 锚点到实时演示）、信任点、内嵌实时演示台
// 与 compact 服务状态条。同页锚点用原生 <a>（见 MktNavbar 说明）。
import { Check, ArrowRight } from "@element-plus/icons-vue";
import { useTranslation } from "i18next-vue";
import KnowledgeConsole from "@/components/marketing/KnowledgeConsole.vue";
import LiveStatus from "@/components/marketing/LiveStatus.vue";

const { t } = useTranslation();
</script>

<template>
  <section class="hero">
    <div class="bg-grid" />
    <div class="bg-orbit" />
    <div class="bg-fade" />

    <div class="inner">
      <div class="center">
        <a
          href="/#workflow"
          class="pill"
        >
          <span class="ping-wrap">
            <span class="ping-ring" />
            <span class="ping-dot" />
          </span>
          {{ t("page.hero.s11") }}
          <el-icon :size="12">
            <ArrowRight />
          </el-icon>
        </a>

        <h1 class="title">
          {{ t("page.hero.s12") }}
          <br>
          <span>{{ t("page.hero.s0") }}</span>
        </h1>

        <p class="subtitle">
          {{ t("page.hero.s13") }}
        </p>

        <div class="ctas">
          <router-link
            to="/register"
            class="btn-primary"
          >
            {{ t("page.hero.s14") }}
            <el-icon :size="14">
              <ArrowRight />
            </el-icon>
          </router-link>
          <a
            href="/#demo"
            class="btn-outline"
          >{{ t("page.hero.s1") }}</a>
        </div>

        <div class="trust">
          <span class="trust-item">
            <el-icon
              :size="13"
              class="trust-ico"
            ><Check /></el-icon>
            {{ t("page.hero.s2") }}
          </span>
          <span class="trust-item">
            <el-icon
              :size="13"
              class="trust-ico"
            ><Check /></el-icon>
            {{ t("page.hero.s3") }}
          </span>
          <span class="trust-item">
            <el-icon
              :size="13"
              class="trust-ico"
            ><Check /></el-icon>
            {{ t("page.hero.s4") }}
          </span>
        </div>
      </div>

      <div
        id="demo"
        class="demo"
      >
        <div class="demo-glow" />
        <KnowledgeConsole />
      </div>

      <div class="status">
        <LiveStatus compact />
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
}
.bg-grid,
.bg-orbit,
.bg-fade {
  position: absolute;
  pointer-events: none;
}
.bg-grid {
  inset: 0;
  z-index: -20;
  background-image:
    linear-gradient(hsl(var(--border) / 0.35) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--border) / 0.35) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 68% 60% at 50% 0%, black, transparent);
  -webkit-mask-image: radial-gradient(ellipse 68% 60% at 50% 0%, black, transparent);
}
.bg-orbit {
  top: -30rem;
  left: 50%;
  z-index: -20;
  height: 900px;
  width: 900px;
  transform: translateX(-50%);
  border-radius: 9999px;
  background: conic-gradient(from 120deg, transparent, hsl(var(--primary) / 0.18), transparent 38%, hsl(var(--brand-to) / 0.12), transparent 74%);
  filter: blur(64px);
  animation: orbit 24s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .bg-orbit {
    animation: none;
  }
}
@keyframes orbit {
  to {
    transform: translateX(-50%) rotate(360deg);
  }
}
.bg-fade {
  inset-inline: 0;
  top: 0;
  z-index: -10;
  height: 440px;
  background: linear-gradient(to bottom, hsl(var(--background) / 0.1), hsl(var(--background) / 0.45), hsl(var(--background)));
}
.inner {
  max-width: 80rem;
  margin: 0 auto;
  padding: 80px 16px 56px;
}
@media (min-width: 640px) {
  .inner {
    padding: 112px 24px 80px;
  }
}
.center {
  max-width: 56rem;
  margin: 0 auto;
  text-align: center;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 9999px;
  background: hsl(var(--card) / 0.7);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  backdrop-filter: blur(16px);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.pill:hover {
  border-color: hsl(var(--primary) / 0.4);
  color: hsl(var(--foreground));
}
.ping-wrap {
  position: relative;
  display: flex;
  height: 8px;
  width: 8px;
}
.ping-ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.55);
  animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ping-ring {
    animation: none;
  }
}
.ping-dot {
  position: relative;
  height: 8px;
  width: 8px;
  border-radius: 9999px;
  background: hsl(var(--primary));
}
@keyframes ping {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}
.title {
  margin: 32px 0 0;
  font-size: 44px;
  font-weight: 600;
  line-height: 0.98;
  letter-spacing: -0.055em;
  text-wrap: balance;
}
@media (min-width: 640px) {
  .title {
    font-size: 68px;
  }
}
@media (min-width: 1024px) {
  .title {
    font-size: 88px;
  }
}
.subtitle {
  max-width: 42rem;
  margin: 28px auto 0;
  font-size: 16px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
  text-wrap: pretty;
}
@media (min-width: 640px) {
  .subtitle {
    font-size: 18px;
  }
}
.ctas {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 36px;
}
@media (min-width: 640px) {
  .ctas {
    flex-direction: row;
  }
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 9999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}
.btn-primary:hover {
  filter: brightness(1.06);
}
.btn-outline {
  display: inline-flex;
  align-items: center;
  padding: 12px 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card) / 0.7);
  backdrop-filter: blur(8px);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  color: inherit;
}
.btn-outline:hover {
  background: hsl(var(--accent));
}
.trust {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 20px;
  margin-top: 28px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.trust-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.trust-ico {
  color: hsl(142 71% 45%);
}
.demo {
  position: relative;
  max-width: 72rem;
  margin: 64px auto 0;
  scroll-margin-top: 80px;
}
@media (min-width: 640px) {
  .demo {
    margin-top: 80px;
  }
}
.demo-glow {
  position: absolute;
  inset: -32px -40px;
  z-index: -10;
  border-radius: 48px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  opacity: 0.045;
  filter: blur(64px);
}
.status {
  max-width: 72rem;
  margin: 24px auto 0;
}
</style>
