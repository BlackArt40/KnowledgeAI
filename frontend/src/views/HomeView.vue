<script setup lang="ts">
// 营销首页（V5，复刻 src/app/page.tsx + src/components/marketing/*）：
// Navbar（登录态区分）→ Hero（含实时演示台）→ Features → Workflow →
// Pricing（三档套餐 @shared/billing/plans）→ CTA → Footer。构建期由
// scripts/prerender-home.mjs 经 @vue/server-renderer 预渲染出 dist/home.html
// 保 SEO（国内搜索引擎不执行 JS），浏览器端正常挂载接管交互。
import { onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  MagicStick, ChatDotRound, Promotion, CircleCheck, Check, ArrowRight,
  Upload, Collection, ChatLineRound, DataAnalysis,
} from "@element-plus/icons-vue";
import { getPlan } from "@shared/billing/plans";
import { request } from "@/api/client";
import MktNavbar from "@/components/marketing/MktNavbar.vue";
import MktHero from "@/components/marketing/MktHero.vue";
import AppLogo from "@/components/AppLogo.vue";

const { t } = useTranslation();
const signedIn = ref(false);

onMounted(async () => {
  // 头部导航反映登录态（已登录显示「进入工作台」）；/api/auth/me 未登录
  // 返回 200 {user:null}，401 豁免清单内不会跳转
  try {
    const d = await request<{ user?: { id: string } | null }>("/api/auth/me");
    signedIn.value = !!d?.user;
  } catch {
    signedIn.value = false;
  }
});
</script>

<template>
  <div class="home">
    <MktNavbar :signed-in="signedIn" />
    <main class="main">
      <MktHero />

      <!-- Features -->
      <section
        id="features"
        class="section"
      >
        <div class="section-inner">
          <div class="features-head">
            <span class="eyebrow">{{ t("page.features.s1") }}</span>
            <h2 class="h2">
              {{ t("page.features.s2") }}
            </h2>
            <p class="lead">
              {{ t("page.features.s3") }}
            </p>
          </div>
          <div class="feature-grid">
            <div
              v-for="item in [
                { icon: MagicStick, title: t('page.features.s4'), desc: t('page.features.s5') },
                { icon: ChatDotRound, title: t('page.features.s9'), desc: t('page.features.s10') },
                { icon: Promotion, title: t('page.features.s12'), desc: t('page.features.s13') },
                { icon: CircleCheck, title: t('page.features.s21'), desc: t('page.features.s22') },
              ]"
              :key="item.title"
              class="feature-card"
            >
              <span class="feature-ico">
                <el-icon :size="18">
                  <component :is="item.icon" />
                </el-icon>
              </span>
              <h3 class="feature-title">
                {{ item.title }}
              </h3>
              <p class="feature-desc">
                {{ item.desc }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Workflow -->
      <section
        id="workflow"
        class="section workflow"
      >
        <div class="section-inner">
          <div class="center-head">
            <span class="eyebrow">{{ t("page.workflow.s8") }}</span>
            <h2 class="h2 center">
              {{ t("page.workflow.s9") }}
            </h2>
            <p class="lead center-text">
              {{ t("page.workflow.s10") }}
            </p>
          </div>
          <div class="flow-grid">
            <div
              v-for="(step, index) in [
                { icon: Upload, title: t('page.workflow.s0') },
                { icon: Collection, title: t('page.workflow.s2') },
                { icon: ChatLineRound, title: t('page.workflow.s4') },
                { icon: DataAnalysis, title: t('page.workflow.s6') },
              ]"
              :key="step.title"
              class="flow-card"
            >
              <span class="flow-ico">
                <el-icon :size="18">
                  <component :is="step.icon" />
                </el-icon>
              </span>
              <div class="flow-text">
                <span class="flow-num">0{{ index + 1 }}</span>
                <span class="flow-title">{{ step.title }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Pricing -->
      <section
        id="pricing"
        class="section"
      >
        <div class="section-inner narrow">
          <div class="center-head">
            <span class="eyebrow">{{ t("page.pricing.s25") }}</span>
            <h2 class="h2 center">
              {{ t("page.pricing.s26") }}
            </h2>
            <p class="lead center-text">
              {{ t("page.pricing.s27") }}
            </p>
          </div>
          <div class="price-grid">
            <div
              v-for="plan in [
                {
                  name: t('page.pricing.s0'), price: `¥${getPlan('free').price}`, period: t('page.pricing.s1'),
                  desc: t('page.pricing.s2'), cta: t('page.pricing.s3'), featured: false,
                  features: [t('page.pricing.s4'), t('page.pricing.s5'), t('page.pricing.s6')],
                },
                {
                  name: t('page.pricing.s8'), price: `¥${getPlan('pro').price}`, period: t('page.pricing.s1'),
                  desc: t('page.pricing.s9'), cta: t('page.pricing.s10'), featured: true,
                  features: [t('page.pricing.s11'), t('page.pricing.s12'), t('page.pricing.s13')],
                },
                {
                  name: t('page.pricing.s16'), price: t('page.pricing.s17'), period: '',
                  desc: t('page.pricing.s18'), cta: t('page.pricing.s19'), featured: false,
                  features: [t('page.pricing.s20'), t('page.pricing.s21'), t('page.pricing.s22')],
                },
              ]"
              :key="plan.name"
              class="price-card"
              :class="{ featured: plan.featured }"
            >
              <div class="price-head">
                <h3 class="price-name">
                  {{ plan.name }}
                </h3>
                <span
                  v-if="plan.featured"
                  class="price-tag"
                >{{ t("page.pricing.s28") }}</span>
              </div>
              <p class="price-desc">
                {{ plan.desc }}
              </p>
              <div class="price-line">
                <span class="price-num">{{ plan.price }}</span>
                <span class="price-period">{{ plan.period }}</span>
              </div>
              <ul class="price-features">
                <li
                  v-for="feature in plan.features"
                  :key="feature"
                >
                  <el-icon
                    :size="13"
                    class="ok-ico"
                  >
                    <Check />
                  </el-icon>
                  {{ feature }}
                </li>
              </ul>
              <router-link
                to="/register"
                class="price-cta"
                :class="{ primary: plan.featured }"
              >
                {{ plan.cta }}
              </router-link>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="cta-section">
        <div class="section-inner">
          <div class="cta-card">
            <div class="cta-grid-bg" />
            <div class="cta-aurora" />
            <h2 class="cta-title">
              {{ t("page.cta.s2") }}<span class="grad-text">{{ t("page.cta.s0") }}</span>
            </h2>
            <p class="cta-desc">
              {{ t("page.cta.s3") }}
            </p>
            <div class="cta-btns">
              <router-link
                to="/register"
                class="btn-grad"
              >
                {{ t("page.cta.s4") }}
                <el-icon :size="14">
                  <ArrowRight />
                </el-icon>
              </router-link>
              <router-link
                to="/login"
                class="btn-plain"
              >
                {{ t("page.cta.s1") }}
              </router-link>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="footer">
      <div class="footer-inner">
        <AppLogo />
        <nav class="footer-links">
          <a
            href="/#features"
            class="flink"
          >{{ t("page.navbar.s2") }}</a>
          <a
            href="/#pricing"
            class="flink"
          >{{ t("page.navbar.s4") }}</a>
          <router-link
            to="/docs"
            class="flink"
          >
            {{ t("page.navbar.s5") }}
          </router-link>
          <router-link
            to="/privacy"
            class="flink"
          >
            {{ t("page.footer.s15") }}
          </router-link>
        </nav>
        <p class="copyright">
          © {{ new Date().getFullYear() }} KnowledgeAI
        </p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.main {
  flex: 1;
}
.section {
  scroll-margin-top: 80px;
  padding: 80px 0;
}
@media (min-width: 640px) {
  .section {
    padding: 96px 0;
  }
}
.section-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 16px;
}
@media (min-width: 640px) {
  .section-inner {
    padding: 0 24px;
  }
}
.section-inner.narrow {
  max-width: 64rem;
}
.workflow {
  border-top: 1px solid hsl(var(--border));
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.25);
}
.features-head {
  max-width: 42rem;
}
.eyebrow {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 2px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card) / 0.7);
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.h2 {
  margin: 0;
  font-size: 34px;
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.045em;
  text-wrap: balance;
}
@media (min-width: 640px) {
  .h2 {
    font-size: 44px;
  }
}
.h2.center {
  text-align: center;
}
.lead {
  margin: 20px 0 0;
  font-size: 15px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}
.center-head {
  max-width: 42rem;
  margin: 0 auto;
  text-align: center;
}
.center-text {
  text-wrap: pretty;
}
.feature-grid {
  display: grid;
  gap: 16px;
  margin-top: 48px;
}
@media (min-width: 768px) {
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.feature-card {
  padding: 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
  transition: border-color 0.15s;
}
.feature-card:hover {
  border-color: hsl(var(--primary) / 0.35);
}
.feature-ico {
  display: inline-flex;
  height: 40px;
  width: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  transition: all 0.15s;
}
.feature-card:hover .feature-ico {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.feature-title {
  margin: 20px 0 0;
  font-size: 17px;
  font-weight: 600;
}
.feature-desc {
  max-width: 36rem;
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}
.flow-grid {
  display: grid;
  gap: 12px;
  margin-top: 48px;
}
@media (min-width: 640px) {
  .flow-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 1024px) {
  .flow-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
.flow-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.flow-ico {
  display: flex;
  height: 40px;
  width: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.flow-text {
  display: flex;
  align-items: center;
  gap: 12px;
}
.flow-num {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.flow-title {
  font-size: 14px;
  font-weight: 600;
}
.price-grid {
  display: grid;
  gap: 16px;
  margin-top: 48px;
}
@media (min-width: 1024px) {
  .price-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
.price-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.price-card.featured {
  border-color: hsl(var(--primary) / 0.45);
  box-shadow: 0 16px 32px hsl(var(--primary) / 0.05);
}
.price-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.price-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.price-tag {
  padding: 4px 10px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.price-desc {
  margin: 8px 0 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.price-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 24px;
}
.price-num {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.price-period {
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.price-features {
  display: grid;
  gap: 12px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}
.price-features li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.ok-ico {
  flex-shrink: 0;
  color: hsl(142 71% 45%);
}
.price-cta {
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: center;
  margin-top: 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  color: inherit;
}
.price-cta:hover {
  background: hsl(var(--accent));
}
.price-cta.primary {
  border-color: transparent;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.price-cta.primary:hover {
  filter: brightness(1.05);
}
.cta-section {
  padding: 80px 0 112px;
}
@media (min-width: 640px) {
  .cta-section {
    padding: 96px 0 128px;
  }
}
.cta-card {
  position: relative;
  overflow: hidden;
  padding: 64px 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 24px;
  background: hsl(var(--card));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  text-align: center;
}
@media (min-width: 640px) {
  .cta-card {
    padding: 64px 64px;
  }
}
.cta-grid-bg {
  position: absolute;
  inset: 0;
  z-index: -10;
  background-image:
    linear-gradient(hsl(var(--border) / 0.35) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--border) / 0.35) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 50% 60% at 50% 50%, black, transparent);
  -webkit-mask-image: radial-gradient(ellipse 50% 60% at 50% 50%, black, transparent);
}
.cta-aurora {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: -10;
  height: 288px;
  width: 42rem;
  transform: translate(-50%, -50%);
  opacity: 0.4;
  background: conic-gradient(from 180deg, hsl(var(--primary) / 0.35), hsl(var(--brand-to) / 0.25), hsl(var(--primary) / 0.35));
  filter: blur(80px);
}
.cta-title {
  max-width: 42rem;
  margin: 0 auto;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-wrap: balance;
}
@media (min-width: 640px) {
  .cta-title {
    font-size: 38px;
  }
}
.grad-text {
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.cta-desc {
  max-width: 28rem;
  margin: 16px auto 0;
  color: hsl(var(--muted-foreground));
  text-wrap: pretty;
}
.cta-btns {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}
@media (min-width: 640px) {
  .cta-btns {
    flex-direction: row;
  }
}
.btn-grad {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 12px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}
.btn-grad:hover {
  filter: brightness(1.05);
}
.btn-plain {
  display: inline-flex;
  align-items: center;
  padding: 12px 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  color: inherit;
}
.btn-plain:hover {
  background: hsl(var(--accent));
}
.footer {
  border-top: 1px solid hsl(var(--border));
}
.footer-inner {
  display: flex;
  max-width: 72rem;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  margin: 0 auto;
  padding: 40px 16px;
}
@media (min-width: 768px) {
  .footer-inner {
    flex-direction: row;
    justify-content: space-between;
    padding: 40px 24px;
  }
}
.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.flink {
  font-size: 14px;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.flink:hover {
  color: hsl(var(--foreground));
}
.copyright {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
</style>
