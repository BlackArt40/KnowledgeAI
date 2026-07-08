import type { AdminUser, AdminOverview, KbMonitor, SystemConfig, UserStatus } from "./types";

type Store = {
  users: AdminUser[];
  kbs: KbMonitor[];
  config: SystemConfig;
  seeded: boolean;
};
const g = globalThis as unknown as { __KAI_ADMIN_STORE__?: Store };

const NOW = Date.now();
const DAY = 86400000;

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 8)}`;
}

function store(): Store {
  if (!g.__KAI_ADMIN_STORE__) {
    g.__KAI_ADMIN_STORE__ = {
      users: [],
      kbs: [],
      config: {
        defaultModel: "gpt-4o",
        embeddingModel: "bge-m3",
        rateLimitPerMin: 60,
        maxUploadMb: 50,
        maintenanceMode: false,
        allowSignup: true,
      },
      seeded: false,
    };
  }
  return g.__KAI_ADMIN_STORE__;
}

const NAMES = [
  ["张明", "zhangming", "pro", "owner"],
  ["李芳", "lifang", "enterprise", "admin"],
  ["王浩", "wanghao", "pro", "editor"],
  ["赵琳", "zhaolin", "free", "viewer"],
  ["陈杰", "chenjie", "pro", "editor"],
  ["刘洋", "liuyang", "enterprise", "admin"],
  ["周婷", "zhouting", "free", "viewer"],
  ["吴磊", "wulei", "pro", "editor"],
  ["郑雪", "zhengxue", "free", "viewer"],
  ["孙强", "sunqiang", "enterprise", "admin"],
  ["马丽", "mali", "pro", "editor"],
  ["朱涛", "zhutao", "free", "viewer"],
  ["胡静", "hujing", "pro", "editor"],
  ["林峰", "linfeng", "enterprise", "admin"],
  ["黄梅", "huangmei", "free", "viewer"],
] as const;

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;

  s.users = NAMES.map(([name, email, plan, role], i) => ({
    id: `usr_${email}`,
    name: name as string,
    email: `${email}@example.com`,
    plan: plan as AdminUser["plan"],
    status: i % 11 === 0 ? "banned" : i % 7 === 0 ? "trial" : "active",
    role: role as AdminUser["role"],
    kbs: Math.floor(Math.random() * 8) + 1,
    docs: Math.floor(Math.random() * 200) + 5,
    lastActive: NOW - Math.floor(Math.random() * 20) * DAY,
    joinedAt: NOW - (i + 1) * 12 * DAY,
  }));

  const kbNames = ["产品文档库", "技术规范库", "客服FAQ库", "销售话术库", "法律合规库", "研发知识库", "市场调研库", "HR制度库"];
  s.kbs = kbNames.map((name, i) => ({
    id: `kb_mon_${i}`,
    name,
    owner: s.users[i % s.users.length].name,
    docs: Math.floor(Math.random() * 180) + 10,
    size: `${(Math.random() * 800 + 20).toFixed(0)} MB`,
    status: i % 9 === 0 ? "error" : i % 5 === 0 ? "processing" : "ready",
    queries: Math.floor(Math.random() * 5000) + 100,
    updatedAt: NOW - Math.floor(Math.random() * 10) * DAY,
  }));
}

export function getOverview(): AdminOverview {
  seed();
  const s = store();
  const active = s.users.filter((u) => NOW - u.lastActive < 30 * DAY).length;
  const monthlyRevenue = s.users.reduce((sum, u) => {
    if (u.status === "banned") return sum;
    return sum + (u.plan === "pro" ? 49 : u.plan === "enterprise" ? 299 : 0);
  }, 0);
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月"];
  return {
    stats: {
      totalUsers: s.users.length + 847,
      activeUsers30d: active + 312,
      totalKbs: s.kbs.length + 124,
      totalDocs: s.users.reduce((a, u) => a + u.docs, 0) + 3210,
      monthlyRevenue,
      qaThisMonth: 48210,
      agentTasksThisMonth: 1267,
      storageUsedGb: 38.6,
    },
    recentSignups: [...s.users].sort((a, b) => b.joinedAt - a.joinedAt).slice(0, 6),
    revenueTrend: months.map((m, i) => ({ month: m, revenue: 3200 + i * 850 + Math.round(Math.random() * 400) })),
  };
}

export function listUsers(): AdminUser[] {
  seed();
  return [...store().users].sort((a, b) => b.joinedAt - a.joinedAt);
}

export function setUserStatus(id: string, status: UserStatus): AdminUser | null {
  seed();
  const u = store().users.find((u) => u.id === id);
  if (u) u.status = status;
  return u ?? null;
}

export function listKbs(): KbMonitor[] {
  seed();
  return store().kbs;
}

export function getConfig(): SystemConfig {
  seed();
  return store().config;
}

export function updateConfig(patch: Partial<SystemConfig>): SystemConfig {
  seed();
  const s = store();
  s.config = { ...s.config, ...patch };
  return s.config;
}
