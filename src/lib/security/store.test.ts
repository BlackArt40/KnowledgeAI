// P0 regression tests for 2FA state: replay protection and lockout.
//
// Both bugs were reachable with a stolen password only:
//   - the same TOTP code could be replayed inside the ±1 step window
//   - wrong codes had no attempt limit (10^6 online guesses)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTOTP } from "./totp";
import {
  disable2FA,
  is2FAEnabled,
  is2FAVerificationLocked,
  start2FAEnrollment,
  verify2FAEnrollment,
  verify2FALogin,
} from "./store";

const NOW = new Date("2026-10-19T00:00:00Z");

function resetStores(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__KAI_SECURITY_STORE__ = undefined;
  g.__KAI_2FA_LOCKOUT__ = undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
  resetStores();
});

function enroll(userId: string): string {
  const { secret } = start2FAEnrollment(userId, `${userId}@example.dev`);
  const code = generateTOTP(secret, NOW.getTime());
  expect(verify2FAEnrollment(userId, code)).toBe(true);
  expect(is2FAEnabled(userId)).toBe(true);
  return secret;
}

describe("2FA replay protection (P0)", () => {
  it("rejects reusing the same TOTP code, accepts the next step", () => {
    const secret = enroll("usr_replay");
    // Enrollment consumed the current step, so log in with the next one.
    const code = generateTOTP(secret, NOW.getTime() + 30_000);

    expect(verify2FALogin("usr_replay", code)).toBe(true);
    expect(verify2FALogin("usr_replay", code)).toBe(false);
    // Advance one step: the next window accepts a fresh (unconsumed) step.
    vi.setSystemTime(NOW.getTime() + 30_000);
    expect(verify2FALogin("usr_replay", generateTOTP(secret, NOW.getTime() + 60_000))).toBe(true);
  });
});

describe("2FA verification lockout (P0)", () => {
  it("locks after 5 wrong codes and rejects a correct code while locked", () => {
    const secret = enroll("usr_lock");
    // 10 steps in the past is outside the ±1 step acceptance window.
    const wrong = generateTOTP(secret, NOW.getTime() - 10 * 30_000);

    for (let i = 0; i < 5; i++) {
      expect(verify2FALogin("usr_lock", wrong)).toBe(false);
    }
    expect(is2FAVerificationLocked("usr_lock")).toBe(true);

    // Even the correct code is refused until the 15-minute lock expires.
    expect(verify2FALogin("usr_lock", generateTOTP(secret, NOW.getTime() + 60_000))).toBe(false);
  });

  it("clears the lockout when 2FA is disabled", () => {
    const secret = enroll("usr_reset");
    const wrong = generateTOTP(secret, NOW.getTime() - 10 * 30_000);
    for (let i = 0; i < 5; i++) verify2FALogin("usr_reset", wrong);
    expect(is2FAVerificationLocked("usr_reset")).toBe(true);
    disable2FA("usr_reset");
    expect(is2FAVerificationLocked("usr_reset")).toBe(false);
  });
});
