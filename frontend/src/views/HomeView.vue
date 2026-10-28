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
  Upload, Collection, ChatLineRound, DataAnalysis, Document,
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
            <article
              v-for="item in [
                { id: 'chat', icon: MagicStick, title: t('page.features.s4'), desc: t('page.features.s5') },
                { id: 'agent', icon: ChatDotRound, title: t('page.features.s9'), desc: t('page.features.s10') },
                { id: 'kb', icon: Promotion, title: t('page.features.s12'), desc: t('page.features.s13') },
                { id: 'security', icon: CircleCheck, title: t('page.features.s21'), desc: t('page.features.s22') },
              ]"
              :key="item.title"
              class="feature-card"
              :class="`feature-${item.id}`"
            >
              <span class="feature-ico">
                <el-icon :size="19">
                  <component :is="item.icon" />
                </el-icon>
              </span>
              <h3 class="feature-title">
                {{ item.title }}
              </h3>
              <p class="feature-desc">
                {{ item.desc }}
              </p>

              <div
                v-if="item.id === 'chat'"
                class="feature-visual chat-visual"
                aria-hidden="true"
              >
                <div class="answer-preview">
                  <span class="answer-spark"><el-icon :size="14"><MagicStick /></el-icon></span>
                  <span class="answer-lines"><i /><i /><i /></span>
                </div>
                <div class="source-preview">
                  <span
                    v-for="source in [t('page.hero.s5'), t('page.hero.s7')]"
                    :key="source"
                    class="source-chip"
                  >
                    <el-icon :size="11"><Document /></el-icon>
                    {{ source }}
                  </span>
                </div>
              </div>

              <div
                v-else-if="item.id === 'agent'"
                class="feature-visual agent-visual"
                aria-hidden="true"
              >
                <div
                  v-for="(step, index) in [t('page.dashboard.s4'), t('page.dashboard.s5'), t('page.dashboard.s6'), t('page.dashboard.s7')]"
                  :key="step"
                  class="agent-step"
                >
                  <span class="agent-check"><el-icon :size="11"><Check /></el-icon></span>
                  <span>{{ step }}</span>
                  <span class="agent-index">0{{ index + 1 }}</span>
                </div>
              </div>

              <div
                v-else-if="item.id === 'kb'"
                class="feature-visual file-stack"
                aria-hidden="true"
              >
                <div
                  v-for="file in [t('page.hero.s42'), t('page.hero.s43'), t('page.hero.s44')]"
                  :key="file"
                  class="file-row"
                >
                  <span class="file-icon"><el-icon :size="13"><Document /></el-icon></span>
                  <span>{{ file }}</span>
                  <el-icon
                    :size="13"
                    class="file-ok"
                  >
                    <CircleCheck />
                  </el-icon>
                </div>
              </div>

              <div
                v-else
                class="feature-visual security-visual"
                aria-hidden="true"
              >
                <div
                  v-for="label in ['2FA', 'RBAC', 'GDPR']"
                  :key="label"
                  class="security-item"
                >
                  <span class="security-check"><el-icon :size="12"><Check /></el-icon></span>
                  <strong>{{ label }}</strong>
                  <span class="security-line" />
                </div>
              </div>
            </article>
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
                { icon: Upload, title: t('page.workflow.s0'), desc: t('page.workflow.s1') },
                { icon: Collection, title: t('page.workflow.s2'), desc: t('page.workflow.s3') },
                { icon: ChatLineRound, title: t('page.workflow.s4'), desc: t('page.workflow.s5') },
                { icon: DataAnalysis, title: t('page.workflow.s6'), desc: t('page.workflow.s7') },
              ]"
              :key="step.title"
              class="flow-card"
            >
              <div class="flow-top">
                <span class="flow-ico">
                  <el-icon :size="18">
                    <component :is="step.icon" />
                  </el-icon>
                </span>
                <span class="flow-num">0{{ index + 1 }}</span>
              </div>
              <div class="flow-text">
                <span class="flow-title">{{ step.title }}</span>
                <span class="flow-desc">{{ step.desc }}</span>
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
  scroll-margin-top: 88px;
  padding: 84px 0;
}
@media (min-width: 640px) {
  .section {
    padding: 108px 0;
  }
}
.section-inner {
  max-width: 80rem;
  margin: 0 auto;
  padding: 0 20px;
}
@media (min-width: 640px) {
  .section-inner {
    padding: 0 32px;
  }
}
.section-inner.narrow {
  max-width: 72rem;
}
.workflow {
  border-top: 1px solid hsl(var(--border));
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.32);
}
.features-head {
  max-width: 44rem;
}
.eyebrow {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 4px 10px;
  border-radius: 7px;
  background: hsl(var(--primary) / 0.07);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: hsl(var(--primary));
}
.h2 {
  margin: 0;
  font-size: 32px;
  font-weight: 650;
  line-height: 1.12;
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
  gap: 18px;
  margin-top: 52px;
}
.feature-card {
  display: flex;
  min-width: 0;
  min-height: 350px;
  flex-direction: column;
  padding: 26px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 20px;
  background: hsl(var(--card));
  box-shadow: var(--shadow-xs);
  transition: transform 240ms var(--ease-out), border-color 240ms ease, box-shadow 240ms ease;
}
.feature-card:hover {
  border-color: hsl(var(--primary) / 0.24);
  box-shadow: var(--shadow-sm);
  transform: translateY(-3px);
}
.feature-ico {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--primary) / 0.1);
  border-radius: 12px;
  background: hsl(var(--primary) / 0.075);
  color: hsl(var(--primary));
  transition: transform 240ms var(--ease-out), background-color 240ms ease;
}
.feature-card:hover .feature-ico {
  background: hsl(var(--primary) / 0.12);
  transform: translateY(-2px) rotate(-3deg);
}
.feature-title {
  margin: 20px 0 0;
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.feature-desc {
  max-width: 36rem;
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.75;
  color: hsl(var(--muted-foreground));
}
.feature-visual {
  margin-top: auto;
  padding-top: 28px;
}
.answer-preview {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px;
  border: 1px solid hsl(var(--border) / 0.85);
  border-radius: 14px 14px 4px 14px;
  background: hsl(var(--muted) / 0.42);
}
.answer-spark {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.answer-lines {
  display: grid;
  flex: 1;
  gap: 7px;
  padding-top: 3px;
}
.answer-lines i {
  display: block;
  width: 100%;
  height: 6px;
  border-radius: 99px;
  background: hsl(var(--muted-foreground) / 0.2);
}
.answer-lines i:nth-child(2) {
  width: 88%;
}
.answer-lines i:nth-child(3) {
  width: 62%;
}
.source-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.source-chip {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 8px;
  background: hsl(var(--card));
  font-size: 10px;
  color: hsl(var(--muted-foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-visual {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.agent-step {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 13px 11px;
  border: 1px solid hsl(var(--border) / 0.85);
  border-radius: 11px;
  background: hsl(var(--muted) / 0.35);
  font-size: 12px;
  font-weight: 550;
}
.agent-check {
  display: inline-flex;
  width: 21px;
  height: 21px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--success) / 0.12);
  color: hsl(var(--success));
}
.agent-index {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 400;
  color: hsl(var(--muted-foreground) / 0.7);
}
.file-stack {
  display: grid;
  gap: 8px;
}
.file-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 10px;
  background: hsl(var(--card));
  box-shadow: var(--shadow-xs);
  font-size: 11px;
}
.file-row > span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-icon {
  display: inline-flex;
  color: hsl(var(--primary));
}
.file-ok {
  margin-left: auto;
  color: hsl(var(--success));
}
.security-visual {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.security-item {
  display: flex;
  min-width: 0;
  min-height: 106px;
  flex-direction: column;
  padding: 14px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 13px;
  background: hsl(240 16% 11%);
  color: #fff;
}
.security-check {
  display: inline-flex;
  width: 23px;
  height: 23px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: rgb(255 255 255 / 0.09);
  color: hsl(152 55% 65%);
}
.security-item strong {
  margin-top: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
}
.security-line {
  width: 70%;
  height: 3px;
  margin-top: 9px;
  border-radius: 99px;
  background: rgb(255 255 255 / 0.12);
}
@media (min-width: 768px) {
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .feature-grid {
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }
  .feature-chat,
  .feature-security {
    grid-column: span 7;
  }
  .feature-agent,
  .feature-kb {
    grid-column: span 5;
  }
  .feature-card {
    padding: 30px;
  }
}
@media (max-width: 420px) {
  .feature-card {
    min-height: 0;
    padding: 22px;
  }
  .security-visual {
    gap: 7px;
  }
  .security-item {
    min-height: 96px;
    padding: 11px;
  }
}
.flow-grid {
  display: grid;
  gap: 14px;
  margin-top: 52px;
}
.flow-card {
  position: relative;
  display: flex;
  min-height: 190px;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
  box-shadow: var(--shadow-xs);
}
.flow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.flow-ico {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}
.flow-text {
  display: grid;
  gap: 8px;
}
.flow-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.72);
}
.flow-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.flow-desc {
  font-size: 12px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}
@media (min-width: 640px) {
  .flow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .flow-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .flow-card:not(:last-child)::after {
    position: absolute;
    top: 43px;
    right: -15px;
    z-index: 2;
    width: 15px;
    height: 1px;
    background: hsl(var(--primary) / 0.32);
    content: "";
  }
}
.price-grid {
  display: grid;
  gap: 18px;
  margin-top: 56px;
}
.price-card {
  display: flex;
  min-height: 410px;
  flex-direction: column;
  padding: 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 18px;
  background: hsl(var(--card));
  box-shadow: var(--shadow-xs);
}
.price-card.featured {
  border-color: hsl(243 40% 28%);
  background:
    radial-gradient(circle at 100% 0%, hsl(var(--primary) / 0.2), transparent 38%),
    hsl(240 16% 11%);
  box-shadow: var(--shadow-md);
  color: #fff;
}
.price-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.price-name {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}
.price-tag {
  padding: 4px 9px;
  border-radius: 7px;
  background: hsl(var(--primary) / 0.09);
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.featured .price-tag {
  background: rgb(255 255 255 / 0.1);
  color: rgb(255 255 255 / 0.86);
}
.price-desc {
  min-height: 40px;
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
}
.price-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-top: 26px;
}
.price-num {
  font-size: 42px;
  font-weight: 650;
  letter-spacing: -0.045em;
}
.price-period {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.price-features {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 13px;
  margin: 28px 0 0;
  padding: 24px 0 0;
  border-top: 1px solid hsl(var(--border) / 0.8);
  list-style: none;
}
.price-features li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.featured .price-desc,
.featured .price-period,
.featured .price-features li {
  color: rgb(255 255 255 / 0.64);
}
.featured .price-features {
  border-color: rgb(255 255 255 / 0.1);
}
.ok-ico {
  flex-shrink: 0;
  color: hsl(var(--success));
}
.featured .ok-ico {
  color: hsl(152 55% 65%);
}
.price-cta {
  display: flex;
  height: 42px;
  align-items: center;
  justify-content: center;
  margin-top: 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
  color: inherit;
  transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.price-cta:hover {
  border-color: hsl(var(--primary) / 0.25);
  background: hsl(var(--accent));
  transform: translateY(-1px);
}
.price-cta.primary {
  border-color: transparent;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.price-cta.primary:hover {
  filter: brightness(1.05);
}
.featured .price-cta.primary {
  background: #fff;
  color: hsl(240 16% 11%);
}
.featured .price-cta.primary:hover {
  background: hsl(243 80% 95%);
}
@media (min-width: 768px) {
  .price-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .price-card.featured {
    transform: translateY(-8px);
  }
}
.cta-section {
  padding: 24px 0 104px;
}
.cta-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 52px 24px;
  border: 1px solid rgb(255 255 255 / 0.09);
  border-radius: 24px;
  background: hsl(240 16% 11%);
  box-shadow: var(--shadow-md);
  color: #fff;
  text-align: center;
}
.cta-grid-bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px);
  background-size: 52px 52px;
  mask-image: radial-gradient(ellipse 70% 80% at 70% 50%, black, transparent);
  -webkit-mask-image: radial-gradient(ellipse 70% 80% at 70% 50%, black, transparent);
}
.cta-aurora {
  position: absolute;
  top: -180px;
  right: -80px;
  z-index: -1;
  width: 460px;
  height: 460px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.32);
  filter: blur(100px);
}
.cta-title {
  max-width: 42rem;
  margin: 0 auto;
  font-size: 30px;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.035em;
  text-wrap: balance;
}
.grad-text {
  color: hsl(243 80% 79%);
}
.cta-desc {
  max-width: 30rem;
  margin: 16px auto 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgb(255 255 255 / 0.62);
  text-wrap: pretty;
}
.cta-btns {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 28px;
}
.btn-grad,
.btn-plain {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
  transition: transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}
.btn-grad {
  background: hsl(var(--primary));
  box-shadow: 0 8px 24px hsl(var(--primary) / 0.22);
  color: hsl(var(--primary-foreground));
}
.btn-grad:hover {
  box-shadow: 0 12px 30px hsl(var(--primary) / 0.3);
  transform: translateY(-1px);
}
.btn-plain {
  border: 1px solid rgb(255 255 255 / 0.14);
  background: rgb(255 255 255 / 0.055);
  color: #fff;
}
.btn-plain:hover {
  background: rgb(255 255 255 / 0.1);
  transform: translateY(-1px);
}
@media (min-width: 640px) {
  .cta-card {
    padding: 56px 48px;
  }
  .cta-title {
    font-size: 36px;
  }
  .cta-btns {
    flex-direction: row;
  }
}
@media (min-width: 960px) {
  .cta-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 48px;
    align-items: center;
    padding: 56px 60px;
    text-align: left;
  }
  .cta-title,
  .cta-desc {
    grid-column: 1;
    margin-left: 0;
  }
  .cta-btns {
    grid-column: 2;
    grid-row: 1 / span 2;
    flex-direction: column;
    align-items: stretch;
    margin-top: 0;
  }
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
