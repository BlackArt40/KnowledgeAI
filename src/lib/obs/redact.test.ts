// P0 (batch 1): free-text redaction — the path pino's key-based `redact`
// cannot reach (provider error bodies, exception messages, URLs).
import { describe, it, expect } from "vitest";
import { REDACT_TEXT_MAX, safeString, truncate, redactText } from "./redact";

describe("safeString", () => {
  it("passes strings through untouched", () => {
    expect(safeString("plain")).toBe("plain");
  });

  it("serializes plain objects", () => {
    expect(safeString({ a: 1 })).toBe('{"a":1}');
  });

  it("falls back to String() on circular structures instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(safeString(circular)).toBe("[object Object]");
  });

  it("serializes numeric primitives", () => {
    expect(safeString(42)).toBe("42");
  });
});

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("caps long strings with a marker", () => {
    const out = truncate("abcdefghij", 4);
    expect(out).toBe("abcd…(truncated)");
    expect(out).not.toBe("abcdefghij");
  });

  it("defaults to REDACT_TEXT_MAX", () => {
    expect(truncate("x".repeat(REDACT_TEXT_MAX))).toHaveLength(REDACT_TEXT_MAX);
    expect(truncate("x".repeat(REDACT_TEXT_MAX + 1))).toContain("(truncated)");
  });
});

describe("redactText", () => {
  it("masks sk-/pk-/rk- API keys", () => {
    const out = redactText("provider error: sk-abcdefghijklmnopqrstuvwxyz failed");
    expect(out).toContain("sk-***");
    expect(out).not.toContain("abcdefghijklmnop");
  });

  it("masks bearer tokens case-insensitively", () => {
    expect(redactText("Authorization: bearer abc.def.ghi-jkl")).toContain("Bearer ***");
    expect(redactText("Bearer somelongtokenvalue")).not.toContain("somelongtokenvalue");
  });

  it.each([
    ["api_key=supersecretvalue"],
    ["password: hunter2hunter2"],
    ["client_secret=abcdef123456"],
    ["private-key: zzzzzzzzzzzz"],
  ])("masks key/value assignments: %s", (input) => {
    const out = redactText(input);
    expect(out).toContain("***");
    expect(out).not.toMatch(/supersecretvalue|hunter2hunter2|abcdef123456|zzzzzzzzzzzz/);
  });

  it("masks credentials embedded in URLs", () => {
    const out = redactText("fetch https://alice:secret@example.com/path failed");
    expect(out).toContain("https://***@example.com/path");
    expect(out).not.toContain("alice");
  });

  it("keeps short non-secret assignments readable", () => {
    // "token=abc" is shorter than the 6-char minimum — nothing to leak, keep it.
    expect(redactText("token=abc")).toBe("token=abc");
  });

  it("truncates the redacted result to the requested cap", () => {
    const out = redactText("x".repeat(50), 10);
    expect(out.startsWith("xxxxxxxxxx")).toBe(true);
    expect(out).toContain("(truncated)");
  });

  it("never throws on non-string input", () => {
    expect(() => redactText({ nested: { password: "hunter2hunter2" } })).not.toThrow();
    expect(typeof redactText({ nested: { password: "hunter2hunter2" } })).toBe("string");
  });

  // Provider error bodies are JSON, which is the main reason this helper
  // exists: the unquoted rule stops at the quote, so quoted values need their
  // own pass. Redaction must keep the payload parseable.
  it("masks secrets inside JSON bodies and keeps them valid JSON", () => {
    const out = redactText({ password: "hunter2hunter2" });
    expect(out).toContain("***");
    expect(out).not.toContain("hunter2hunter2");
    expect(JSON.parse(out)).toEqual({ password: "***" });
  });

  it("masks nested JSON keys and comma-containing values", () => {
    const out = redactText({
      error: { client_secret: "abcd1234,efgh5678", api_key: "sk_live_value_1234567890" },
    });
    expect(out).not.toContain("abcd1234");
    expect(out).not.toContain("sk_live_value_1234567890");
    const parsed = JSON.parse(out) as { error: { client_secret: string; api_key: string } };
    expect(parsed.error.client_secret).toBe("***");
    expect(parsed.error.api_key).toBe("***");
  });

  it("leaves short JSON values readable (below the 6-char minimum)", () => {
    expect(redactText({ token: "abc" })).toBe('{"token":"abc"}');
  });

  it("keeps already-redacted bearer tokens inside JSON untouched", () => {
    expect(redactText({ authorization: "Bearer abc.def.ghi" })).toContain("Bearer ***");
  });
});
