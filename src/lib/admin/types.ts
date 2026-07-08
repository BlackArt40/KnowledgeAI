export type UserStatus = "active" | "banned" | "trial";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  plan: "free" | "pro" | "enterprise";
  status: UserStatus;
  role: "owner" | "admin" | "editor" | "viewer";
  kbs: number;
  docs: number;
  lastActive: number;
  joinedAt: number;
}

export interface SystemStats {
  totalUsers: number;
  activeUsers30d: number;
  totalKbs: number;
  totalDocs: number;
  monthlyRevenue: number;
  qaThisMonth: number;
  agentTasksThisMonth: number;
  storageUsedGb: number;
}

export interface KbMonitor {
  id: string;
  name: string;
  owner: string;
  docs: number;
  size: string;
  status: "ready" | "processing" | "error";
  queries: number;
  updatedAt: number;
}

export interface SystemConfig {
  defaultModel: string;
  embeddingModel: string;
  rateLimitPerMin: number;
  maxUploadMb: number;
  maintenanceMode: boolean;
  allowSignup: boolean;
}

export interface AdminOverview {
  stats: SystemStats;
  recentSignups: AdminUser[];
  revenueTrend: { month: string; revenue: number }[];
}
