<script setup lang="ts">
// 收银台（V4，复刻 src/app/(app)/checkout/page.tsx）：?plan= 深链接、订单
// 摘要、支付方式（微信/支付宝/卡）、模拟支付（POST checkout → sleep →
// POST checkout/{id}）、处理中/成功/免支付四态。网关与 Next 完全同契约。
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { ArrowLeft, ChatDotRound, Wallet, CreditCard, Check, MagicStick, Postcard, CircleCheck } from "@element-plus/icons-vue";
import { getPlan, PLANS } from "@shared/billing/plans";
import type { PayMethod, PlanId } from "@shared/billing/types";
import { checkoutOrder, payOrder } from "@/api/billing";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const planId = ref<PlanId>("pro");
const method = ref<PayMethod>("wechat");
const phase = ref<"form" | "processing" | "success">("form");
const error = ref<string | null>(null);

onMounted(() => {
  const q = route.query.plan;
  if (typeof q === "string" && PLANS.some((p) => p.id === q)) planId.value = q as PlanId;
});

const plan = computed(() => getPlan(planId.value));
const noPayment = computed(() => plan.value.price === 0 || plan.value.price === null);

const METHODS: { id: PayMethod; labelKey: string; hintKey: string; icon: object; tint: string }[] = [
  { id: "wechat", labelKey: "page.checkout.s6", hintKey: "page.checkout.s7", icon: ChatDotRound, tint: "wechat" },
  { id: "alipay", labelKey: "page.checkout.s8", hintKey: "page.checkout.s9", icon: Wallet, tint: "alipay" },
  { id: "card", labelKey: "page.checkout.s10", hintKey: "page.checkout.s10h", icon: CreditCard, tint: "card" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function confirm() {
  error.value = null;
  phase.value = "processing";
  try {
    const r1 = await checkoutOrder(planId.value, method.value);
    await sleep(2600); // 模拟扫码/网关确认等待
    const res = await payOrder(r1.order.id);
    if (!res.success) throw new Error("pay failed");
    phase.value = "success";
  } catch {
    error.value = t("page.checkout.s11");
    phase.value = "form";
  }
}

const processingLabel = () =>
  method.value === "wechat" ? t("page.checkout.s14") : method.value === "alipay" ? t("page.checkout.s8") : t("page.checkout.s10");
</script>

<template>
  <div class="checkout-page">
    <router-link
      to="/billing"
      class="back"
    >
      <el-icon :size="12">
        <ArrowLeft />
      </el-icon>
      {{ t("page.checkout.s19") }}
    </router-link>

    <div class="panel">
      <!-- 订单摘要 -->
      <div class="head-row">
        <h2>{{ t("page.checkout.s0") }}</h2>
        <span class="plan-badge">{{ plan.name }}</span>
      </div>
      <div class="summary">
        <div>
          <p class="s-name">
            {{ plan.name }}
          </p>
          <p class="s-feat">
            {{ plan.features[0] }}
          </p>
        </div>
        <div class="s-price">
          <p class="price">
            {{ plan.price === null ? t("page.checkout.s20") : plan.price === 0 ? t("page.checkout.s21") : `¥${plan.price}` }}
          </p>
          <p class="period">
            /{{ plan.period }}
          </p>
        </div>
      </div>

      <!-- 成功态 -->
      <div
        v-if="phase === 'success'"
        class="state"
      >
        <span class="state-ava success">
          <el-icon :size="28">
            <Check />
          </el-icon>
        </span>
        <h3>{{ t("page.checkout.s4") }}</h3>
        <p class="state-desc">
          {{ t("page.checkout.s27") }} <b>{{ plan.name }}</b>{{ t("page.checkout.s28") }}
        </p>
        <el-button
          type="primary"
          :icon="MagicStick"
          @click="router.push('/billing')"
        >
          {{ t("page.checkout.s29") }}
        </el-button>
      </div>

      <!-- 免支付（免费版 / 企业定制） -->
      <div
        v-else-if="noPayment"
        class="state"
      >
        <span class="state-ava plain">
          <el-icon :size="24">
            <MagicStick />
          </el-icon>
        </span>
        <h3>{{ plan.price === 0 ? t("page.checkout.s15") : t("page.checkout.s16") }}</h3>
        <p class="state-desc">
          {{ plan.price === 0 ? t("page.checkout.s17") : t("page.checkout.s18") }}
        </p>
        <el-button
          type="primary"
          @click="router.push('/billing')"
        >
          {{ t("page.checkout.s5") }}
        </el-button>
      </div>

      <!-- 处理中 -->
      <div
        v-else-if="phase === 'processing'"
        class="state"
      >
        <div class="qr-box">
          <el-icon
            :size="72"
            class="qr-ico"
          >
            <Postcard />
          </el-icon>
          <span class="qr-tag">{{ t("page.checkout.s3") }}</span>
        </div>
        <p class="state-title">
          <el-icon
            :size="14"
            class="is-loading"
          >
            <Loading />
          </el-icon>
          {{ t("page.checkout.s25", { method: processingLabel() }) }}
        </p>
        <p class="state-desc">
          {{ t("page.checkout.s26", { amount: plan.price ?? 0 }) }}
        </p>
      </div>

      <!-- 表单 -->
      <template v-else>
        <p class="pm-title">
          {{ t("page.checkout.s1") }}
        </p>
        <div class="methods">
          <button
            v-for="m in METHODS"
            :key="m.id"
            type="button"
            class="method"
            :class="{ on: method === m.id }"
            @click="method = m.id"
          >
            <span
              class="m-ava"
              :class="m.tint"
            >
              <el-icon :size="16">
                <component :is="m.icon" />
              </el-icon>
            </span>
            <span class="m-main">
              <span class="m-label">{{ t(m.labelKey) }}</span>
              <span class="m-hint">{{ m.id === "card" ? "Visa / Mastercard" : t(m.hintKey) }}</span>
            </span>
            <span
              class="m-radio"
              :class="{ on: method === m.id }"
            >
              <el-icon
                v-if="method === m.id"
                :size="9"
              >
                <Check />
              </el-icon>
            </span>
          </button>
        </div>
        <p
          v-if="error"
          class="pay-error"
        >
          {{ error }}
        </p>
        <el-button
          type="primary"
          size="large"
          class="pay-btn"
          :icon="CircleCheck"
          @click="confirm"
        >
          {{ t("page.checkout.s22", { price: plan.price ?? 0 }) }}
        </el-button>
        <p class="terms">
          {{ t("page.checkout.s23") }}
          <router-link
            to="/terms"
            class="terms-link"
          >
            {{ t("page.checkout.s2") }}
          </router-link>
          · {{ t("page.checkout.s24") }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.checkout-page {
  max-width: 32rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.back:hover {
  color: hsl(var(--foreground));
}
.panel {
  padding: 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head-row h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.plan-badge {
  padding: 2px 10px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  padding: 16px;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.4);
}
.s-name {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.s-feat {
  margin: 2px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.s-price {
  text-align: right;
}
.price {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.period {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24px;
  padding: 24px 0;
  text-align: center;
}
.state-ava {
  display: flex;
  height: 64px;
  width: 64px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
}
.state-ava.success {
  background: hsl(142 71% 45% / 0.15);
  color: hsl(142 71% 40%);
}
.state-ava.plain {
  height: 56px;
  width: 56px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.state h3 {
  margin: 16px 0 0;
  font-size: 17px;
  font-weight: 600;
}
.state-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 0;
  font-size: 14px;
  font-weight: 500;
}
.state-desc {
  margin: 4px 0 20px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.qr-box {
  position: relative;
  display: flex;
  height: 160px;
  width: 160px;
  align-items: center;
  justify-content: center;
  border: 2px dashed hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--muted) / 0.3);
}
.qr-ico {
  color: hsl(var(--muted-foreground) / 0.6);
}
.qr-tag {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 8px;
  border-radius: 9999px;
  background: hsl(var(--card));
  font-size: 10px;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
}
.pm-title {
  margin: 24px 0 8px;
  font-size: 14px;
  font-weight: 500;
}
.methods {
  display: grid;
  gap: 8px;
}
.method {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s;
}
.method:hover {
  background: hsl(var(--accent) / 0.4);
}
.method.on {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.05);
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.3);
}
.m-ava {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}
.m-ava.wechat {
  background: rgb(16 185 129 / 0.15);
  color: rgb(16 185 129);
}
.m-ava.alipay {
  background: rgb(14 165 233 / 0.15);
  color: rgb(14 165 233);
}
.m-ava.card {
  background: rgb(139 92 246 / 0.15);
  color: rgb(139 92 246);
}
.m-main {
  flex: 1;
}
.m-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
}
.m-hint {
  display: block;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.m-radio {
  display: flex;
  height: 16px;
  width: 16px;
  align-items: center;
  justify-content: center;
  border: 2px solid hsl(var(--border));
  border-radius: 9999px;
  color: #fff;
}
.m-radio.on {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary));
}
.pay-error {
  margin: 12px 0 0;
  font-size: 12px;
  color: hsl(var(--destructive));
}
.pay-btn {
  width: 100%;
  margin-top: 24px;
}
.terms {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.terms-link {
  color: hsl(var(--primary));
  text-decoration: none;
}
.terms-link:hover {
  text-decoration: underline;
}
</style>
