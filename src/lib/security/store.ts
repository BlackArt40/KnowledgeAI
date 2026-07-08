import type { SecurityState, TwoFactor, PrivacySettings, Session } from "./types";

type Store = SecurityState & { seeded: boolean };
const g = globalThis as unknown as { __KAI_SECURITY_STORE__?: Store };

const NOW = Date.now();
const DAY = 86400000;

function store(): Store {
  if (!g.__KAI_SECURITY_STORE__) {
    g.__KAI_SECURITY_STORE__ = {
      twoFactor: { enabled: true, method: "app", backupCodes: genBackup(), enrolledAt: NOW - 30 * DAY },
      sessions: [],
      loginHistory: [],
      privacy: { analytics: true, crashReports: true, trainingOptIn: false, dataRetentionDays: 90 },
      seeded: false,
    };
  }
  return g.__KAI_SECURITY_STORE__;
}

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}
function genBackup() {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("")
  );
}

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  s.sessions = [
    { id: "s1", device: "MacBook Pro", browser: "Chrome 126", ip: "192.168.1.42", location: "上海", current: true, lastActive: NOW },
    { id: "s2", device: "iPhone 15", browser: "Safari", ip: "116.231.20.88", location: "上海", current: false, lastActive: NOW - 3 * 3600_000 },
    { id: "s3", device: "Windows PC", browser: "Edge 126", ip: "114.88.42.10", location: "北京", current: false, lastActive: NOW - 2 * DAY },
  ];
  const devices = ["MacBook Pro", "iPhone 15", "Windows PC", "iPad Air"];
  const locs = ["上海", "北京", "深圳", "杭州"];
  for (let i = 0; i < 14; i++) {
    s.loginHistory.push({
      id: uid("log"),
      device: devices[i % devices.length],
      ip: `116.231.${20 + i}.${10 + i * 3}`,
      location: locs[i % locs.length],
      success: i % 8 === 0 ? false : true,
      ts: NOW - i * 9 * 3600_000 - Math.floor(Math.random() * 3600_000),
    });
  }
}

export function getSecurity(): SecurityState {
  seed();
  const s = store();
  return {
    twoFactor: s.twoFactor,
    sessions: s.sessions,
    loginHistory: s.loginHistory,
    privacy: s.privacy,
  };
}

export function enable2FA(method: TwoFactor["method"]): TwoFactor {
  seed();
  const s = store();
  s.twoFactor = { enabled: true, method, backupCodes: genBackup(), enrolledAt: Date.now() };
  return s.twoFactor;
}

export function disable2FA(): TwoFactor {
  seed();
  const s = store();
  s.twoFactor = { enabled: false, method: null, backupCodes: [], enrolledAt: null };
  return s.twoFactor;
}

export function revokeSession(id: string): Session[] {
  seed();
  const s = store();
  s.sessions = s.sessions.filter((x) => x.id !== id);
  return s.sessions;
}

export function revokeAllSessions(): Session[] {
  seed();
  const s = store();
  s.sessions = s.sessions.filter((x) => x.current);
  return s.sessions;
}

export function updatePrivacy(patch: Partial<PrivacySettings>): PrivacySettings {
  seed();
  const s = store();
  s.privacy = { ...s.privacy, ...patch };
  return s.privacy;
}

// GDPR: export all user data as a JSON string
export function exportData(): string {
  seed();
  const s = store();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      twoFactor: s.twoFactor,
      sessions: s.sessions,
      loginHistory: s.loginHistory,
      privacy: s.privacy,
      note: "演示数据导出。生产环境将聚合用户全部数据（知识库、会话、账单等）。",
    },
    null, 2
  );
}
