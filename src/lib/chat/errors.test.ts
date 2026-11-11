// Chat failure classification: the client must be able to tell "retry later"
// apart from "the key is dead" — the old single message made quota exhaustion
// look transient.
import { describe, expect, it } from "vitest";
import { classifyChatError } from "./errors";

describe("classifyChatError", () => {
  it("reads a provider 429 as quota exhaustion", () => {
    const out = classifyChatError({ name: "AI_APICallError", statusCode: 429, message: "Too Many Requests" });
    expect(out.code).toBe("upstream_quota");
    expect(out.status).toBe(429);
    expect(out.message).toContain("额度");
  });

  it("reads an insufficient-balance body as quota even without a status", () => {
    const out = classifyChatError({
      name: "AI_NoOutputGeneratedError",
      message: "No output generated. Check the stream for errors.",
      cause: {
        message: "provider error",
        responseBody: JSON.stringify({ code: 30001, message: "Sorry, your account balance is insufficient" }),
      },
    });
    expect(out.code).toBe("upstream_quota");
    expect(out.status).toBeUndefined();
  });

  it("reads 401/403 (including nested causes) as an auth failure", () => {
    expect(classifyChatError({ statusCode: 401, message: "Unauthorized" }).code).toBe("upstream_auth");
    expect(
      classifyChatError({
        name: "AI_NoOutputGeneratedError",
        message: "No output generated",
        cause: { statusCode: 403, message: "invalid api key" },
      }).code
    ).toBe("upstream_auth");
  });

  it("prefers quota over auth when the provider says both", () => {
    // Some gateways answer 403 with a balance message; retry guidance must win.
    expect(classifyChatError({ statusCode: 403, message: "insufficient balance" }).code).toBe("upstream_quota");
  });

  it("reads timeouts and connection resets as transient", () => {
    expect(classifyChatError({ name: "TimeoutError", message: "The operation timed out" }).code).toBe("upstream_timeout");
    expect(classifyChatError({ message: "read ECONNRESET" }).code).toBe("upstream_timeout");
  });

  it("treats an aborted request as internal (the client already left)", () => {
    const err = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(classifyChatError(err).code).toBe("internal");
  });

  it("reads a zero-token stream as an empty response, not a generic error", () => {
    expect(classifyChatError(new Error("模型未返回内容（empty_response）")).code).toBe("empty_response");
    expect(
      classifyChatError(new Error("AI_NoOutputGeneratedError: No output generated. Check the stream for errors.")).code
    ).toBe("empty_response");
  });

  it("falls back to internal for unknown errors and odd values", () => {
    expect(classifyChatError(new Error("boom")).code).toBe("internal");
    expect(classifyChatError(undefined).code).toBe("internal");
    expect(classifyChatError("string error").code).toBe("internal");
    expect(classifyChatError({ cause: { cause: { cause: { statusCode: 429 } } } }).code).toBe("upstream_quota");
  });

  it("never echoes provider bodies back to the client", () => {
    const secret = "sk-live-abcdefghijklmnop";
    const out = classifyChatError({ statusCode: 500, message: "upstream said", responseBody: `{"key":"${secret}"}` });
    expect(out.message).not.toContain(secret);
    expect(out.message).not.toContain("upstream said");
  });
});
