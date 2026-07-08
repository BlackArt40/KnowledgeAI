export interface TwoFactor {
  enabled: boolean;
  method: "app" | "sms" | null;
  backupCodes: string[];
  enrolledAt: number | null;
}

export interface Session {
  id: string;
  device: string;
  browser: string;
  ip: string;
  location: string;
  current: boolean;
  lastActive: number;
}

export interface LoginEvent {
  id: string;
  device: string;
  ip: string;
  location: string;
  success: boolean;
  ts: number;
}

export interface PrivacySettings {
  analytics: boolean;
  crashReports: boolean;
  trainingOptIn: boolean;
  dataRetentionDays: number;
}

export interface SecurityState {
  twoFactor: TwoFactor;
  sessions: Session[];
  loginHistory: LoginEvent[];
  privacy: PrivacySettings;
}
