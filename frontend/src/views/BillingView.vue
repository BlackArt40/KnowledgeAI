<script setup lang="ts">
// 订阅计费（V4，复刻 src/app/(app)/billing/page.tsx）：当前套餐卡（状态/
// 周期/席位/支付方式/cancelAtPeriodEnd）、取消|恢复|升级、套餐对比表
// （PLANS+COMPARISON 单源 @shared/billing/plans）、账单列表 + CSV 导出。
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { CreditCard, Download, RefreshRight, MagicStick, Star, Coin } from "@element-plus/icons-vue";
import { COMPARISON } from "@shared/billing/plans";
import { METHOD_LABEL, STATUS_LABEL, type Invoice, type Plan } from "@shared/billing/types";
import { cancelResume, fetchBilling, type BillingData } from "@/api/billing";

const { t } = useTranslation();
const router = useRouter();

const data = ref<BillingData | null>(null);
const loading = ref(true);
const canceling = ref(false);

async function fetchAll() {
  try {
    data.value = await fetchBilling();
  } catch {
    /* 渲染层由 data null 走加载失败态 */
  }
  loading.value = false;
}

onMounted(() => void fetchAll());

async function toggleCancel(action: "cancel" | "resume") {
  canceling.value = true;
  try {
    await cancelResume(action);
    await fetchAll();
  } catch {
    /* ignore */
  } finally {
    canceling.value = false;
  }
}

function downloadInvoices() {
  if (!data.value) return;
  const rows = [
    [t("page.billing.s6"), t("page.billing.s7"), t("page.billing.s8"), t("page.billing.s9"), t("page.billing.s10"), t("page.billing.s11")],
  ];
  data.value.invoices.forEach((i: Invoice) =>
    rows.push([i.id, new Date(i.date).toLocaleDateString("zh-CN"), String(i.amount), i.plan, i.status, METHOD_LABEL[i.method]])
  );
  const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "invoices.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function isPlan(p: Plan | undefined): p is Plan {
  return !!p;
}
const currentPlan = (): Plan | undefined => {
  const s = data.value?.subscription;
  return s ? data.value?.plans.find((p) => p.id === s.plan) : undefined;
};
</script>

<template>
  <div class="billing-page">
    <template v-if="loading || !data">
      <el-skeleton
        class="sk"
        animated
      >
        <template #template>
          <el-skeleton-item
            variant="rect"
            style="height: 112px; border-radius: 16px"
          />
          <el-skeleton-item
            variant="rect"
            style="height: 320px; border-radius: 16px; margin-top: 16px"
          />
        </template>
      </el-skeleton>
    </template>

    <template v-else>
      <!-- 当前套餐 -->
      <div class="plan-card">
        <div class="plan-grad" />
        <div class="plan-body">
          <div class="plan-id">
            <span class="plan-ava">
              <el-icon :size="18">
                <Star />
              </el-icon>
            </span>
            <div>
              <div class="plan-name-row">
                <h2>{{ currentPlan()?.name }}</h2>
                <span
                  class="badge"
                  :class="data.subscription.status === 'active' ? 'ok' : 'warn'"
                >{{ STATUS_LABEL[data.subscription.status] }}</span>
                <span
                  v-if="data.subscription.cancelAtPeriodEnd"
                  class="badge warn"
                >{{ t("page.billing.s0") }}</span>
              </div>
              <p class="plan-meta">
                {{ currentPlan()?.price === null ? t("page.billing.s12") : `¥${currentPlan()?.price}/${currentPlan()?.period}` }} ·
                {{ t("page.billing.s20", { count: data.subscription.seats }) }} ·
                {{ t("page.billing.s11") }} {{ data.subscription.paymentMethod ? METHOD_LABEL[data.subscription.paymentMethod.type] : "—" }}
              </p>
              <p class="plan-period">
                {{ t("page.billing.s21") }}{{ new Date(data.subscription.periodStart).toLocaleDateString("zh-CN") }} ~
                {{ new Date(data.subscription.periodEnd).toLocaleDateString("zh-CN") }}
              </p>
            </div>
          </div>
          <div class="plan-actions">
            <el-button
              v-if="data.subscription.status === 'canceled'"
              type="primary"
              :loading="canceling"
              :icon="RefreshRight"
              @click="toggleCancel('resume')"
            >
              {{ t("page.billing.s22") }}
            </el-button>
            <el-button
              v-else-if="data.subscription.plan !== 'enterprise'"
              type="primary"
              :icon="MagicStick"
              @click="router.push('/checkout?plan=enterprise')"
            >
              {{ t("page.billing.s23") }}
            </el-button>
            <el-button
              v-if="data.subscription.status !== 'canceled' && data.subscription.plan !== 'free'"
              :loading="canceling"
              @click="toggleCancel('cancel')"
            >
              {{ t("page.billing.s24") }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- 套餐对比 -->
      <div>
        <h3 class="sec-title">
          {{ t("page.billing.s1") }}
        </h3>
        <div class="table-wrap">
          <div class="table-scroll">
            <table class="cmp">
              <thead>
                <tr>
                  <th class="left">
                    {{ t("page.billing.s2") }}
                  </th>
                  <th
                    v-for="p in data.plans"
                    :key="p.id"
                  >
                    <div
                      class="th-name"
                      :class="{ on: p.id === data.subscription.plan }"
                    >
                      {{ p.name }}
                      <span
                        v-if="p.id === data.subscription.plan"
                        class="badge mini"
                      >{{ t("page.billing.s3") }}</span>
                    </div>
                    <div class="th-price">
                      {{ p.price === null ? t("page.billing.s13") : p.price === 0 ? t("page.billing.s14") : `¥${p.price}/${p.period}` }}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in COMPARISON"
                  :key="row.label"
                >
                  <td class="left label">
                    {{ row.label }}
                  </td>
                  <td
                    v-for="(v, i) in row.values"
                    :key="i"
                    class="val"
                  >
                    <template v-if="typeof v === 'boolean'">
                      <span
                        class="bool"
                        :class="{ yes: v }"
                      >{{ v ? "✓" : "✕" }}</span>
                    </template>
                    <span v-else>{{ v }}</span>
                  </td>
                </tr>
                <tr>
                  <td />
                  <td
                    v-for="p in data.plans.filter(isPlan)"
                    :key="p.id"
                    class="val"
                  >
                    <span
                      v-if="p.id === data.subscription.plan"
                      class="cur"
                    >{{ t("page.billing.s4") }}</span>
                    <el-button
                      v-else-if="p.price === null"
                      size="small"
                      @click="router.push(`/checkout?plan=${p.id}`)"
                    >
                      {{ t("page.billing.s5") }}
                    </el-button>
                    <el-button
                      v-else
                      size="small"
                      :type="p.highlight ? 'primary' : 'default'"
                      @click="router.push(`/checkout?plan=${p.id}`)"
                    >
                      {{ p.price === 0 ? t("page.billing.s15") : t("page.billing.s16") }}
                    </el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 账单 -->
      <div class="card">
        <div class="inv-head">
          <h3 class="sec-title inline">
            <el-icon
              :size="14"
              class="inv-ico"
            >
              <CreditCard />
            </el-icon>
            {{ t("page.billing.s25") }}
          </h3>
          <el-button
            size="small"
            :icon="Download"
            @click="downloadInvoices"
          >
            {{ t("page.billing.s26") }}
          </el-button>
        </div>
        <div class="inv-list">
          <div
            v-for="inv in data.invoices"
            :key="inv.id"
            class="inv"
          >
            <span class="inv-ava">
              <el-icon :size="14">
                <Coin />
              </el-icon>
            </span>
            <div class="inv-main">
              <p class="inv-id">
                {{ inv.id }}
              </p>
              <p class="inv-meta">
                {{ new Date(inv.date).toLocaleDateString("zh-CN") }} · {{ METHOD_LABEL[inv.method] }}
              </p>
            </div>
            <span
              class="badge"
              :class="inv.status === 'paid' ? 'ok' : inv.status === 'pending' ? 'warn' : 'bad'"
            >
              {{ inv.status === "paid" ? t("page.billing.s17") : inv.status === "pending" ? t("page.billing.s18") : t("page.billing.s19") }}
            </span>
            <span class="inv-amount">¥{{ inv.amount }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.billing-page {
  max-width: 64rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.plan-card {
  position: relative;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.plan-grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, hsl(var(--primary) / 0.1), transparent);
  pointer-events: none;
}
.plan-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
@media (min-width: 640px) {
  .plan-body {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
.plan-id {
  display: flex;
  align-items: center;
  gap: 16px;
}
.plan-ava {
  display: flex;
  height: 48px;
  width: 48px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
}
.plan-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.plan-name-row h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.plan-meta {
  margin: 2px 0 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.plan-period {
  margin: 2px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.plan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}
.badge.ok {
  background: hsl(142 71% 45% / 0.12);
  color: hsl(142 71% 35%);
}
.badge.warn {
  background: #f59e0b22;
  color: #b45309;
}
.badge.bad {
  background: hsl(var(--destructive) / 0.12);
  color: hsl(var(--destructive));
}
.badge.mini {
  padding: 0 5px;
  font-size: 10px;
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}
.sec-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.sec-title.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.table-wrap {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
}
.table-scroll {
  overflow-x: auto;
}
.cmp {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.cmp thead tr {
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.4);
}
.cmp th,
.cmp td {
  padding: 12px 16px;
  text-align: center;
}
.cmp .left {
  text-align: left;
  font-weight: 500;
}
.cmp .label {
  font-weight: 500;
}
.cmp tbody tr {
  border-bottom: 1px solid hsl(var(--border));
}
.cmp tbody tr:last-child {
  border-bottom: 0;
}
.th-name {
  font-weight: 600;
}
.th-name.on {
  color: hsl(var(--primary));
}
.th-price {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
}
.val {
  color: hsl(var(--muted-foreground));
}
.bool {
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.4);
}
.bool.yes {
  color: hsl(142 71% 45%);
}
.cur {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.card {
  padding: 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.inv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.inv-ico {
  color: hsl(var(--primary));
}
.inv {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid hsl(var(--border));
}
.inv:last-child {
  border-bottom: 0;
}
.inv-ava {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}
.inv-main {
  min-width: 0;
  flex: 1;
}
.inv-id {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
.inv-meta {
  margin: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.inv-amount {
  width: 80px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.sk {
  display: block;
}
</style>
