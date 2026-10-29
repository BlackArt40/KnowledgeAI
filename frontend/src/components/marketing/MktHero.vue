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
    <div class="bg-rings" />
    <div class="bg-fade" />

    <div class="inner">
      <div class="hero-layout">
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
            <span class="title-accent">{{ t("page.hero.s0") }}</span>
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
              <el-icon :size="15">
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
  isolation: isolate;
  overflow: hidden;
  border-bottom: 1px solid hsl(var(--border) / 0.72);
  background:
    radial-gradient(ellipse 55% 55% at 84% 22%, hsl(var(--primary) / 0.075), transparent 72%),
    hsl(var(--background));
}
.bg-grid,
.bg-rings,
.bg-fade {
  position: absolute;
  z-index: -1;
  pointer-events: none;
}
.bg-grid {
  inset: 0;
  background-image:
    linear-gradient(hsl(var(--border) / 0.42) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--border) / 0.42) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: linear-gradient(to bottom, black, transparent 72%);
  -webkit-mask-image: linear-gradient(to bottom, black, transparent 72%);
  opacity: 0.6;
}
.bg-rings {
  top: -280px;
  right: -240px;
  width: 760px;
  height: 760px;
  border: 1px solid hsl(var(--primary) / 0.09);
  border-radius: 50%;
  box-shadow:
    0 0 0 100px hsl(var(--primary) / 0.018),
    0 0 0 200px hsl(var(--primary) / 0.012);
}
.bg-fade {
  inset-inline: 0;
  bottom: 0;
  height: 180px;
  background: linear-gradient(to top, hsl(var(--background)), transparent);
}
.inner {
  position: relative;
  max-width: 80rem;
  margin: 0 auto;
  padding: 64px 20px 40px;
}
.hero-layout {
  display: grid;
  gap: 52px;
  align-items: center;
}
.center {
  max-width: 52rem;
  margin: 0 auto;
  text-align: center;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-full);
  background: hsl(var(--card) / 0.76);
  box-shadow: var(--shadow-xs);
  backdrop-filter: blur(16px);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
  transition: border-color 160ms ease, color 160ms ease, transform 160ms ease;
}
.pill:hover {
  border-color: hsl(var(--primary) / 0.36);
  color: hsl(var(--foreground));
  transform: translateY(-1px);
}
.ping-wrap {
  position: relative;
  display: flex;
  width: 7px;
  height: 7px;
}
.ping-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.55);
  animation: ping-hero 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.ping-dot {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: hsl(var(--primary));
}
@keyframes ping-hero {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}
.title {
  margin: 28px 0 0;
  font-size: clamp(40px, 10vw, 62px);
  font-weight: 650;
  line-height: 1.06;
  letter-spacing: -0.058em;
  text-wrap: balance;
}
.title-accent {
  color: hsl(var(--primary));
}
.subtitle {
  max-width: 39rem;
  margin: 24px auto 0;
  font-size: 16px;
  line-height: 1.8;
  color: hsl(var(--muted-foreground));
  text-wrap: pretty;
}
.ctas {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 30px;
}
.btn-primary,
.btn-outline {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  transition: transform 180ms var(--ease-out), box-shadow 180ms ease, border-color 180ms ease, background-color 180ms ease;
}
.btn-primary {
  background: hsl(var(--primary));
  box-shadow: 0 8px 20px hsl(var(--primary) / 0.2);
  color: hsl(var(--primary-foreground));
}
.btn-primary:hover {
  box-shadow: 0 12px 26px hsl(var(--primary) / 0.26);
  transform: translateY(-2px);
}
.btn-outline {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card) / 0.8);
  box-shadow: var(--shadow-xs);
  backdrop-filter: blur(8px);
  color: hsl(var(--foreground));
}
.btn-outline:hover {
  border-color: hsl(var(--primary) / 0.3);
  background: hsl(var(--card));
  transform: translateY(-2px);
}
.trust {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 18px;
  margin-top: 24px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.trust-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.trust-ico {
  color: hsl(var(--success));
}
.demo {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 72rem;
  margin: 0 auto;
  scroll-margin-top: 96px;
}
.demo-glow {
  position: absolute;
  inset: -24px;
  z-index: -1;
  border-radius: 40px;
  background: hsl(var(--primary) / 0.12);
  filter: blur(54px);
  opacity: 0.5;
}
/* 演示台（KnowledgeConsole）与状态条（LiveStatus）的 hero 形态已收敛进各自组件，
   这里不再穿透子组件内部类名；仅保留定位用的外边距。 */
.status {
  margin: 26px auto 0;
}
@media (min-width: 640px) {
  .inner {
    padding: 80px 28px 44px;
  }
  .ctas {
    flex-direction: row;
  }
  .subtitle {
    font-size: 17px;
  }
}
@media (min-width: 1180px) {
  .inner {
    padding: 84px 32px 44px;
  }
  .hero-layout {
    grid-template-columns: minmax(400px, 0.86fr) minmax(0, 1.14fr);
    gap: 44px;
  }
  .center {
    margin: 0;
    text-align: left;
  }
  .title {
    font-size: 56px;
  }
  .subtitle {
    margin-left: 0;
    font-size: 16px;
  }
  .ctas,
  .trust {
    justify-content: flex-start;
  }
}
@media (min-width: 1380px) {
  .title {
    font-size: 60px;
  }
  .hero-layout {
    gap: 52px;
  }
}
@media (max-width: 479px) {
  .ctas > * {
    width: 100%;
  }
  .trust {
    align-items: flex-start;
    flex-direction: column;
    width: max-content;
    margin-inline: auto;
  }
}
</style>
