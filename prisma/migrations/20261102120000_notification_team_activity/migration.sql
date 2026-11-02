-- 可观测与通知：团队活动通道（成员 / 权限 / 分享事件）。
-- 旧偏好行默认开启，避免升级后用户静默收不到团队动态。
ALTER TABLE "NotificationPrefs" ADD COLUMN "teamActivity" BOOLEAN NOT NULL DEFAULT true;
