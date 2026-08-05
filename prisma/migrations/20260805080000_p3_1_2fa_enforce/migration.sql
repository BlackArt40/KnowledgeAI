-- P3-1 2FA Enforcement: admin can require specific roles to enable 2FA.
-- Stores the list of roles (e.g. ["owner","admin"]) that must enroll in TOTP
-- before they can complete login.
ALTER TABLE "SystemConfig" ADD COLUMN "required2FARoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
