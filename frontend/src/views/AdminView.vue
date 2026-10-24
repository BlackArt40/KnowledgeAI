<script setup lang="ts">
// 管理后台（V5，复刻 src/app/(app)/admin/page.tsx）：八张统计卡 + 收入趋势
// + 用户列表（搜索/封禁·解封 PATCH status）+ 系统配置（模型/上传限制/注册/
// 维护模式/2FA 角色矩阵，PATCH 立即或保存）+ KB 监控表 + 速率限制看板
// （模式徽标/档位/活跃维度实时表）+ Provider 状态 + 安全审计（链完整性/
// action·actor 过滤）。owner/admin（AppShell routeGuard 兜底）。
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  User, TrendCharts, Coin, Collection, ChatLineRound, MagicStick, Box, Search,
  Setting, Odometer, WarningFilled, CircleCheck, Document, RefreshRight, CreditCard, Delete,
} from "@element-plus/icons-vue";
import { formatMoney, formatRelative } from "@shared/format";
import { planLabelKey } from "@/lib/plan";
import type { AdminOverview, AdminUser, KbMonitor, SystemConfig } from "@/api/admin";
import {
  fetchOverview, fetchAdminUsers, fetchAdminKbs, fetchAdminConfig, patchAdminConfig,
  setUserStatus, deleteAdminUser, fetchRatelimit, fetchAudit,
  type ProviderStatus, type RateLimitDashboard, type AuditResponse,
} from "@/api/admin";
import { fetchCurrentUser } from "@/api/auth";

const { t } = useTranslation();

const overview = ref<AdminOverview | null>(null);
const users = ref<AdminUser[]>([]);
const kbs = ref<KbMonitor[]>([]);
const config = ref<SystemConfig | null>(null);
const providers = ref<ProviderStatus[]>([]);
const ratelimit = ref<RateLimitDashboard | null>(null);
const audit = ref<AuditResponse | null>(null);
const auditAction = ref("");
const auditActor = ref("");
const loading = ref(true);
const search = ref("");
const savingCfg = ref(false);
const loadFailed = ref(false);
/** 当前登录者：删号按钮只对 owner 开放，且不显示在自己/其他 Owner 行上 */
const myId = ref("");
const myRole = ref("");

async function loadMe() {
  const me = await fetchCurrentUser().catch(() => null);
  myId.value = me?.id ?? "";
  myRole.value = me?.role ?? "";
}

async function refresh() {
  // 各接口独立容错（403/429 等）：拿得到的先渲染，概览+配置齐了才算就绪
  const [o, u, k, c, rl, au] = await Promise.allSettled([
    fetchOverview(),
    fetchAdminUsers(),
    fetchAdminKbs(),
    fetchAdminConfig(),
    fetchRatelimit(),
    fetchAudit(),
  ]);
  if (o.status === "fulfilled") overview.value = o.value;
  if (u.status === "fulfilled") users.value = u.value;
  if (k.status === "fulfilled") kbs.value = k.value;
  if (c.status === "fulfilled") {
    config.value = { ...c.value };
    providers.value = c.value.providers ?? [];
  }
  if (rl.status === "fulfilled") ratelimit.value = rl.value;
  if (au.status === "fulfilled") audit.value = au.value;
  loadFailed.value = !overview.value || !config.value;
  loading.value = false;
}

onMounted(() => {
  void refresh();
  void loadMe();
});

async function toggleUserStatus(id: string, status: "active" | "banned") {
  try {
    await setUserStatus(id, status);
  } catch {
    /* ignore */
  }
  void refresh();
}

async function removeUser(u: AdminUser) {
  if (!window.confirm(t("page.admin.s79", { name: u.name }))) return;
  try {
    await deleteAdminUser(u.id);
  } catch {
    /* 403/404 等由列表刷新体现，不额外弹窗 */
  }
  await refresh();
}

async function patchConfig(patch: Partial<SystemConfig>) {
  savingCfg.value = true;
  try {
    await patchAdminConfig(patch);
  } catch {
    // 保存失败：以服务端为准回滚乐观更新
  }
  await refresh();
  savingCfg.value = false;
}

const ROLE_OPTIONS = [
  { role: "owner", label: "Owner" },
  { role: "admin", label: "Admin" },
  { role: "editor", label: "Editor" },
  { role: "viewer", label: "Viewer" },
];

function toggle2FARole(role: string, on: boolean) {
  if (!config.value) return;
  const current = new Set(config.value.required2FARoles);
  if (on) current.add(role);
  else current.delete(role);
  const next = ROLE_OPTIONS.map((r) => r.role).filter((r) => current.has(r));
  config.value = { ...config.value, required2FARoles: next };
  void patchConfig({ required2FARoles: next });
}

async function searchAudit() {
  try {
    audit.value = await fetchAudit(auditAction.value || undefined, auditActor.value || undefined);
  } catch {
    /* ignore */
  }
}

function clearAudit() {
  auditAction.value = "";
  auditActor.value = "";
  void refresh();
}

const filteredUsers = computed(() =>
  users.value.filter(
    (u) => u.name.includes(search.value) || u.email.includes(search.value) || u.id.includes(search.value)
  )
);

const statusLabel = () => ({ active: t("page.admin.s42"), banned: t("page.admin.s43") } as const);
const kbStatusLabel = () => ({ ready: t("page.admin.s44"), processing: t("page.admin.s45"), error: t("page.admin.s46") } as const);

function rlKind(kind: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    ip: { label: "IP", cls: "muted" },
    user: { label: t("page.admin.s80"), cls: "primary" },
    apikey: { label: "API Key", cls: "outline" },
    kb: { label: t("page.admin.s82"), cls: "warn" },
    integration: { label: t("page.admin.s48"), cls: "muted" },
    agent: { label: "Agent", cls: "warn" },
    other: { label: t("page.admin.s47"), cls: "outline" },
  };
  return map[kind] ?? map.other;
}

function rlResetIn(resetAt: number): string {
  const secs = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
  return secs <= 0 ? t("page.admin.s67") : `${secs}s`;
}

const statCards = computed(() => {
  const s = overview.value?.stats;
  if (!s) return [];
  return [
    { icon: User, label: t("page.admin.s49"), value: s.totalUsers.toLocaleString(), tint: "qa" },
    { icon: TrendCharts, label: t("page.admin.s50"), value: s.activeUsers30d.toLocaleString(), tint: "api" },
    { icon: Coin, label: t("page.admin.s68"), value: formatMoney(s.monthlyRevenue), tint: "storage" },
    { icon: Collection, label: t("page.admin.s52"), value: s.totalKbs.toLocaleString(), tint: "sky" },
    { icon: ChatLineRound, label: t("page.admin.s53"), value: s.qaThisMonth.toLocaleString(), tint: "agent" },
    { icon: MagicStick, label: t("page.admin.s54"), value: s.agentTasksThisMonth.toLocaleString(), tint: "pink" },
    { icon: Box, label: t("page.admin.s69"), value: `${s.storageUsedGb} GB`, tint: "orange" },
    { icon: Document, label: t("page.admin.s56"), value: s.totalDocs.toLocaleString(), tint: "teal" },
  ];
});

function planLabel(plan: string): string {
  const key = planLabelKey(plan);
  return key ? t(key) : plan;
}

const maxRev = computed(() => Math.max(...(overview.value?.revenueTrend ?? []).map((r) => r.revenue), 1));
const noRevenue = computed(() => (overview.value?.revenueTrend ?? []).every((r) => !r.revenue));
</script>

<template>
  <div class="admin-page">
    <!-- 加载 / 失败 -->
    <template v-if="loading">
      <div class="sk" />
      <div class="sk-grid">
        <div
          v-for="i in 8"
          :key="i"
          class="sk small"
        />
      </div>
      <div class="sk tall" />
    </template>
    <div
      v-else-if="loadFailed"
      class="fail"
    >
      <p>{{ t("page.app-shell.s4") }}</p>
      <el-button
        :icon="RefreshRight"
        @click="loading = true; refresh()"
      >
        {{ t("common.retry") }}
      </el-button>
    </div>

    <template v-else>
      <div class="head">
        <span class="admin-badge">{{ t("page.admin.s84") }}</span>
        <h1>{{ t("page.app-shell.s17") }}</h1>
      </div>

      <!-- 统计卡 -->
      <div class="cards">
        <div
          v-for="s in statCards"
          :key="s.label"
          class="stat"
        >
          <div class="stat-head">
            <span
              class="stat-icon"
              :class="['tint', s.tint]"
            >
              <el-icon :size="18">
                <component :is="s.icon" />
              </el-icon>
            </span>
          </div>
          <p class="stat-value">
            {{ s.value }}
          </p>
          <p class="stat-label">
            {{ s.label }}
          </p>
        </div>
      </div>

      <!-- 收入趋势 -->
      <div class="card">
        <h3 class="card-title">
          <el-icon
            :size="14"
            class="title-ico"
          >
            <Coin />
          </el-icon>
          {{ t("page.admin.s0") }}
        </h3>
        <div class="rev-chart">
          <p
            v-if="noRevenue"
            class="rev-empty"
          >
            {{ t("page.admin.s77") }}
          </p>
          <div
            v-for="r in overview!.revenueTrend"
            :key="r.month"
            class="rev-col"
          >
            <div class="rev-bar-wrap">
              <div
                class="rev-bar"
                :style="{ height: `${(r.revenue / maxRev) * 100}%` }"
                :title="formatMoney(r.revenue)"
              />
            </div>
            <span class="rev-month">{{ r.month }}</span>
          </div>
        </div>
      </div>

      <div class="two-col">
        <!-- 用户列表 -->
        <div class="card wide">
          <div class="card-head">
            <h3 class="card-title">
              <el-icon
                :size="14"
                class="title-ico"
              >
                <User />
              </el-icon>
              {{ t("page.admin.s1") }}
            </h3>
            <div class="search-box">
              <el-icon
                :size="12"
                class="search-ico"
              >
                <Search />
              </el-icon>
              <input
                v-model="search"
                class="search-input"
                :placeholder="t('page.admin.s57')"
                :aria-label="t('page.admin.s57')"
              >
            </div>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ t("page.admin.s80") }}</th>
                <th>{{ t("page.admin.s81") }}</th>
                <th>{{ t("page.admin.s82") }}</th>
                <th>{{ t("page.admin.s7") }}</th>
                <th>{{ t("page.admin.s8") }}</th>
                <th class="right">
                  {{ t("page.admin.s9") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="u in filteredUsers.slice(0, 12)"
                :key="u.id"
              >
                <td>
                  <div class="u-name">
                    {{ u.name }}
                  </div>
                  <div class="u-mail">
                    {{ u.email }}
                  </div>
                </td>
                <td>
                  <span
                    class="badge"
                    :class="u.plan === 'enterprise' ? 'primary' : u.plan === 'pro' ? 'muted' : 'outline'"
                  >{{ planLabel(u.plan) }}</span>
                </td>
                <td class="num">
                  {{ u.kbs }}
                </td>
                <td class="muted-cell">
                  {{ formatRelative(u.lastActive) }}
                </td>
                <td>
                  <span
                    class="badge"
                    :class="u.status === 'active' ? 'ok' : 'bad'"
                  >{{ statusLabel()[u.status] }}</span>
                </td>
                <td class="right">
                  <el-button
                    v-if="u.status === 'banned'"
                    size="small"
                    text
                    class="ok-btn"
                    :icon="CircleCheck"
                    @click="toggleUserStatus(u.id, 'active')"
                  >
                    {{ t("page.admin.s70") }}
                  </el-button>
                  <el-button
                    v-else
                    size="small"
                    text
                    class="danger-btn"
                    :icon="WarningFilled"
                    @click="toggleUserStatus(u.id, 'banned')"
                  >
                    {{ t("page.admin.s71") }}
                  </el-button>
                  <el-button
                    v-if="myRole === 'owner' && u.role !== 'owner' && u.id !== myId"
                    size="small"
                    text
                    type="danger"
                    :icon="Delete"
                    class="danger-btn"
                    @click="removeUser(u)"
                  >
                    {{ t("page.admin.s78") }}
                  </el-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 系统配置 -->
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <Setting />
            </el-icon>
            {{ t("page.admin.s2") }}
          </h3>
          <div class="cfg">
            <label class="cfg-label">{{ t("page.admin.s11") }}</label>
            <el-input
              v-model="config!.defaultModel"
              size="small"
            />
            <label class="cfg-label">{{ t("page.admin.s12") }}</label>
            <el-input
              v-model="config!.embeddingModel"
              size="small"
            />
            <div class="cfg-grid">
              <div>
                <label class="cfg-label">{{ t("page.admin.s13") }}<span class="cfg-hint">{{ t("page.admin.s14") }}</span></label>
                <el-input
                  :model-value="config!.rateLimitPerMin"
                  size="small"
                  readonly
                  class="readonly"
                />
              </div>
              <div>
                <label class="cfg-label">{{ t("page.admin.s15") }}</label>
                <el-input
                  v-model.number="config!.maxUploadMb"
                  type="number"
                  size="small"
                />
              </div>
            </div>
            <div class="divider" />
            <div class="switch-row">
              <div>
                <p class="switch-title">
                  {{ t("page.admin.s16") }}
                </p>
                <p class="switch-sub">
                  {{ t("page.admin.s17") }}
                </p>
              </div>
              <el-switch
                :model-value="config!.allowSignup"
                :aria-label="t('page.admin.s16')"
                @change="(v: string | number | boolean) => patchConfig({ allowSignup: Boolean(v) })"
              />
            </div>
            <div class="switch-row">
              <div>
                <p class="switch-title">
                  {{ t("page.admin.s18") }}
                </p>
                <p class="switch-sub">
                  {{ t("page.admin.s19") }}
                </p>
              </div>
              <el-switch
                :model-value="config!.maintenanceMode"
                :aria-label="t('page.admin.s18')"
                @change="(v: string | number | boolean) => patchConfig({ maintenanceMode: Boolean(v) })"
              />
            </div>
            <div class="divider" />
            <div>
              <p class="switch-title">
                {{ t("page.admin.s20") }}
              </p>
              <p class="switch-sub">
                {{ t("page.admin.s21") }}
              </p>
              <div class="role-grid">
                <label
                  v-for="r in ROLE_OPTIONS"
                  :key="r.role"
                  class="role-row"
                >
                  <span class="role-name">{{ r.label }}</span>
                  <el-switch
                    :model-value="config!.required2FARoles.includes(r.role)"
                    size="small"
                    :aria-label="`${r.label} · ${t('page.admin.s20')}`"
                    @change="(v: string | number | boolean) => toggle2FARole(r.role, Boolean(v))"
                  />
                </label>
              </div>
            </div>
            <el-button
              size="small"
              class="save-btn"
              :loading="savingCfg"
              @click="patchConfig(config!)"
            >
              {{ t("page.admin.s72") }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- KB 监控 -->
      <div class="card">
        <h3 class="card-title">
          <el-icon
            :size="14"
            class="title-ico"
          >
            <Odometer />
          </el-icon>
          {{ t("page.admin.s3") }}
        </h3>
        <table class="tbl">
          <thead>
            <tr>
              <th>{{ t("page.admin.s83") }}</th>
              <th>{{ t("page.admin.s23") }}</th>
              <th>{{ t("page.admin.s24") }}</th>
              <th>{{ t("page.admin.s25") }}</th>
              <th>{{ t("page.admin.s26") }}</th>
              <th>{{ t("page.admin.s8") }}</th>
              <th>{{ t("page.admin.s27") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="kb in kbs"
              :key="kb.id"
            >
              <td class="u-name">
                {{ kb.name }}
              </td>
              <td class="muted-cell">
                {{ kb.owner }}
              </td>
              <td class="num">
                {{ kb.docs }}
              </td>
              <td class="muted-cell">
                {{ kb.size }}
              </td>
              <td class="num">
                {{ kb.queries.toLocaleString() }}
              </td>
              <td>
                <span
                  class="badge"
                  :class="kb.status === 'ready' ? 'ok' : kb.status === 'processing' ? 'warn' : 'bad'"
                >{{ kbStatusLabel()[kb.status] }}</span>
              </td>
              <td class="muted-cell">
                {{ formatRelative(kb.updatedAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="two-col">
        <!-- 速率限制 -->
        <div class="card">
          <div class="card-head">
            <h3 class="card-title">
              <el-icon
                :size="14"
                class="title-ico"
              >
                <CreditCard />
              </el-icon>
              {{ t("page.admin.s4") }}
            </h3>
            <span
              class="badge"
              :class="ratelimit?.mode === 'redis' ? 'ok' : 'muted'"
            >{{ ratelimit?.mode === "redis" ? t("page.admin.s58") : t("page.admin.s59") }}</span>
          </div>
          <div class="cfg">
            <div
              v-if="ratelimit"
              class="rl-limits"
            >
              <div class="rl-limit">
                <div class="rl-label">
                  {{ t("page.admin.s80") }}
                </div>
                <div class="rl-val">
                  {{ ratelimit.limits.base }}<span class="rl-unit">{{ t("page.admin.s29") }}</span>
                </div>
              </div>
              <div class="rl-limit">
                <div class="rl-label">
                  {{ t("page.admin.s60") }}
                </div>
                <div class="rl-val">
                  {{ ratelimit.limits.anon }}<span class="rl-unit">{{ t("page.admin.s29") }}</span>
                </div>
              </div>
              <div class="rl-limit">
                <div class="rl-label">
                  API Key
                </div>
                <div class="rl-val">
                  {{ ratelimit.limits.key }}<span class="rl-unit">{{ t("page.admin.s29") }}</span>
                </div>
              </div>
              <div class="rl-limit">
                <div class="rl-label">
                  {{ t("page.admin.s82") }}
                </div>
                <div class="rl-val">
                  {{ ratelimit.limits.kb }}<span class="rl-unit">{{ t("page.admin.s29") }}</span>
                </div>
              </div>
            </div>
            <table class="tbl">
              <thead>
                <tr>
                  <th>{{ t("page.admin.s30") }}</th>
                  <th>Key</th>
                  <th class="right">
                    {{ t("page.admin.s31") }}
                  </th>
                  <th class="right">
                    {{ t("page.admin.s32") }}
                  </th>
                  <th class="right">
                    {{ t("page.admin.s33") }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="(ratelimit?.live ?? []).length === 0">
                  <td
                    colspan="5"
                    class="empty-cell"
                  >
                    {{ t("page.admin.s73") }}
                  </td>
                </tr>
                <tr
                  v-for="s in (ratelimit?.live ?? []).slice(0, 12)"
                  :key="s.key"
                >
                  <td>
                    <span
                      class="badge"
                      :class="rlKind(s.kind).cls"
                    >{{ rlKind(s.kind).label }}</span>
                  </td>
                  <td
                    class="mono-cell"
                    :title="s.key"
                  >
                    {{ s.key }}
                  </td>
                  <td class="right num">
                    {{ s.count }}<span class="muted-cell">/{{ s.limit }}</span>
                  </td>
                  <td class="right">
                    <span
                      class="badge"
                      :class="s.remaining <= 0 ? 'bad' : s.remaining / s.limit < 0.2 ? 'warn' : 'muted'"
                    >{{ s.remaining }}</span>
                  </td>
                  <td class="right muted-cell num">
                    {{ rlResetIn(s.resetAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <el-button
              size="small"
              class="refresh-btn"
              :icon="RefreshRight"
              @click="refresh"
            >
              {{ t("page.admin.s74") }}
            </el-button>
          </div>
        </div>

        <!-- Provider 状态 -->
        <div class="card">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <WarningFilled />
            </el-icon>
            {{ t("page.admin.s5") }}
          </h3>
          <div class="providers">
            <div
              v-for="p in providers"
              :key="p.id"
              class="provider"
            >
              <div class="p-main">
                <div class="p-head">
                  <span class="p-label">{{ p.label }}</span>
                  <span
                    class="badge"
                    :class="p.enabled ? 'ok' : 'muted'"
                  >{{ p.enabled ? t("page.admin.s61") : t("page.admin.s62") }}</span>
                </div>
                <p
                  class="p-detail"
                  :title="p.detail"
                >
                  {{ p.detail }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 安全审计 -->
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">
            <el-icon
              :size="14"
              class="title-ico"
            >
              <Document />
            </el-icon>
            {{ t("page.admin.s6") }}
          </h3>
          <div class="audit-badges">
            <span
              class="badge"
              :class="audit?.chainValid ? 'ok' : 'bad'"
            >{{ audit?.chainValid ? t("page.admin.s63") : t("page.admin.s64") }}</span>
            <span class="badge muted">{{ t("page.admin.s75", { count: audit?.total ?? 0 }) }}</span>
          </div>
        </div>
        <div class="cfg">
          <div class="audit-filters">
            <el-input
              v-model="auditAction"
              size="small"
              class="audit-input"
              :placeholder="t('page.admin.s65')"
            />
            <el-input
              v-model="auditActor"
              size="small"
              class="audit-input narrow"
              :placeholder="t('page.admin.s66')"
            />
            <el-button
              size="small"
              @click="searchAudit"
            >
              {{ t("page.admin.s36") }}
            </el-button>
            <el-button
              size="small"
              text
              @click="clearAudit"
            >
              {{ t("page.admin.s33") }}
            </el-button>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ t("page.admin.s37") }}</th>
                <th>{{ t("page.admin.s38") }}</th>
                <th>{{ t("page.admin.s39") }}</th>
                <th>{{ t("page.admin.s40") }}</th>
                <th>{{ t("page.admin.s41") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="(audit?.audit ?? []).length === 0">
                <td
                  colspan="5"
                  class="empty-cell"
                >
                  {{ t("page.admin.s76") }}
                </td>
              </tr>
              <tr
                v-for="e in (audit?.audit ?? []).slice(0, 30)"
                :key="e.id"
              >
                <td class="muted-cell nowrap">
                  {{ formatRelative(e.createdAt) }}
                </td>
                <td class="u-mail">
                  {{ e.actor }}
                </td>
                <td>
                  <span class="badge muted mono">{{ e.action }}</span>
                </td>
                <td class="u-mail">
                  {{ e.target }}
                </td>
                <td
                  class="muted-cell detail-cell"
                  :title="e.detail"
                >
                  {{ e.detail }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.admin-badge {
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--destructive) / 0.12);
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--destructive));
}
.head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sk { height: 64px; border-radius: 16px; }

.sk.small {
  height: 96px;
  border-radius: 12px;
}
.sk.tall {
  height: 384px;
}
.sk-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (min-width: 1024px) {
  .sk-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.fail {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 64px 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.fail p {
  margin: 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (min-width: 1024px) {
  .cards {
    grid-template-columns: repeat(4, 1fr);
  }
}
.stat {
  padding: 18px 20px; /* 与工作台统计卡同构：图标左上、值居中偏下、label 收尾 */
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-icon {
  display: inline-flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: hsl(var(--muted));
}
.stat-label {
  margin: 4px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.stat-value {
  margin: 14px 0 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.tint.qa { color: hsl(var(--primary)); }
.tint.api { color: #10b981; }
.tint.storage { color: #f59e0b; }
.tint.sky { color: #0ea5e9; }
.tint.agent { color: #8b5cf6; }
.tint.pink { color: #ec4899; }
.tint.orange { color: #f97316; }
.tint.teal { color: #14b8a6; }
.card { padding: 20px; border-radius: 16px; }

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.card-head .card-title {
  margin: 0;
}
.title-ico {
  color: hsl(var(--primary));
}
.rev-chart {
  position: relative;
  display: flex;
  height: 160px;
  align-items: flex-end;
  gap: 12px;
  padding-bottom: 22px;
  border-bottom: 1px dashed hsl(var(--border));
}
.rev-empty {
  position: absolute;
  inset: 0 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.rev-col {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
}
.rev-bar-wrap {
  display: flex;
  width: 100%;
  flex: 1;
  align-items: flex-end;
}
.rev-bar {
  width: 100%;
  /* 列宽随容器拉伸，柱子不封顶会变成一排色块；限制宽度后才是柱状图 */
  max-width: 56px;
  margin: 0 auto;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  transition: opacity 0.15s;
}
.rev-bar:hover {
  opacity: 0.8;
}
.rev-month {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.two-col {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
@media (min-width: 1024px) {
  .two-col {
    grid-template-columns: 2fr 1fr;
  }
  .two-col:has(> .card:not(.wide):first-child) {
    grid-template-columns: 1fr 1fr;
  }
}
.search-box {
  position: relative;
  width: 192px;
}
.search-ico {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: hsl(var(--muted-foreground));
}
.search-input {
  height: 32px;
  width: 100%;
  padding: 0 10px 0 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  font: inherit;
  font-size: 12px;
}
.search-input:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  padding: 8px 10px;
  border-bottom: 1px solid hsl(var(--border));
  text-align: left;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.tbl td {
  padding: 10px;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
}
.tbl tbody tr:last-child td {
  border-bottom: 0;
}
.tbl .right {
  text-align: right;
}
.u-name {
  font-weight: 500;
}
.u-mail {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.muted-cell {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.num {
  font-variant-numeric: tabular-nums;
}
.mono-cell {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.mono {
  font-family: var(--font-mono, monospace);
}
.nowrap {
  white-space: nowrap;
}
.detail-cell {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-cell {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.badge { font-weight: 500; }

.badge.ok { background: hsl(142 71% 45% / 0.12); color: hsl(142 71% 35%); }
.badge.warn { background: #f59e0b22; color: #b45309; }
.badge.bad { background: hsl(var(--destructive) / 0.12); color: hsl(var(--destructive)); }
.badge.primary { background: hsl(var(--primary) / 0.12); color: hsl(var(--primary)); }
.badge.muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.badge.outline { border: 1px solid hsl(var(--border)); color: hsl(var(--muted-foreground)); }
.ok-btn { color: hsl(142 71% 40%); }
.danger-btn { color: hsl(var(--destructive)); }
.cfg {
  display: grid;
  gap: 12px;
  margin-top: 8px;
}
.cfg-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.cfg-hint {
  margin-left: 4px;
}
.cfg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.readonly {
  opacity: 0.6;
}
.divider {
  height: 1px;
  background: hsl(var(--border));
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.switch-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.switch-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.role-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.role-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.role-name {
  font-size: 13px;
}
.save-btn {
  width: 100%;
}
.rl-limits {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
@media (min-width: 640px) {
  .rl-limits {
    grid-template-columns: repeat(4, 1fr);
  }
}
.rl-limit {
  padding: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  text-align: center;
}
.rl-label {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.rl-val {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rl-unit {
  font-size: 12px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
}
.refresh-btn {
  width: 100%;
}
.providers {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.provider {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.p-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.p-label {
  font-size: 14px;
  font-weight: 500;
}
.p-detail {
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.audit-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}
.audit-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.audit-input {
  width: 224px;
}
.audit-input.narrow {
  width: 176px;
}
</style>
