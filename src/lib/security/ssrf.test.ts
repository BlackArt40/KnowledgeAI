// F1 / Tessa test-debt (P27): SSRF decision coverage.
// The model `baseUrl` path (F1) was completely unguarded, and `ssrf.ts` had no
// unit test at all - this file is the regression net for both.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: unknown[]) => lookup(...args) },
}));

import {
  isBlockedIp,
  isCloudMetadataIp,
  modelBaseUrlPrecheck,
  resolveSafeModelBaseUrl,
  resolveSafeUrl,
} from "./ssrf";

beforeEach(() => {
  lookup.mockReset();
  delete process.env.LLM_ALLOW_PRIVATE_BASE_URL;
  delete process.env.SSRF_ALLOW_PRIVATE_HOSTS;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBlockedIp", () => {
  it("blocks loopback, private, link-local and CGNAT ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:10.0.0.1", // IPv4-mapped IPv6
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2001:4860:4860::8888"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("fails closed on malformed input", () => {
    expect(isBlockedIp("999.1.1.1")).toBe(true);
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("isCloudMetadataIp", () => {
  it("flags the metadata range in v4 and v6 forms", () => {
    expect(isCloudMetadataIp("169.254.169.254")).toBe(true);
    expect(isCloudMetadataIp("169.254.0.1")).toBe(true);
    expect(isCloudMetadataIp("::ffff:169.254.169.254")).toBe(true);
    expect(isCloudMetadataIp("fe80::1")).toBe(true);
  });

  it("does not flag non-metadata addresses", () => {
    expect(isCloudMetadataIp("10.0.0.1")).toBe(false);
    expect(isCloudMetadataIp("169.253.1.1")).toBe(false);
    expect(isCloudMetadataIp("8.8.8.8")).toBe(false);
  });
});

describe("resolveSafeUrl (webhook / fetch guard)", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(resolveSafeUrl("file:///etc/passwd")).rejects.toThrow("仅允许 http/https URL");
  });

  it("rejects private IP literals by default", async () => {
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).rejects.toThrow("内网/回环");
    await expect(resolveSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow("内网/回环");
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5" }]);
    await expect(resolveSafeUrl("https://internal.example.com/hook")).rejects.toThrow("内网/回环");
  });

  it("rejects when ANY record of a hostname is private (DNS rebinding)", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8" }, { address: "192.168.0.10" }]);
    await expect(resolveSafeUrl("https://mixed.example.com/hook")).rejects.toThrow("内网/回环");
  });

  it("accepts a public URL", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
    await expect(resolveSafeUrl("https://example.com/hook")).resolves.toBeInstanceOf(URL);
  });

  it("allowPrivate is a no-op in production (the dev escape hatch cannot leak)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SSRF_ALLOW_PRIVATE_HOSTS", "true");
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).rejects.toThrow("内网/回环");
  });

  it("F6: fails closed when NODE_ENV is unset or unexpected", async () => {
    // The old gate was `NODE_ENV !== "production"` - a misspelled env opened
    // the hatch on a production box. Only explicit development/test counts now.
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("SSRF_ALLOW_PRIVATE_HOSTS", "true");
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).rejects.toThrow("内网/回环");

    vi.stubEnv("NODE_ENV", "staging");
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).rejects.toThrow("内网/回环");
  });

  it("relaxes outside production when explicitly opted in (webhook smoke receiver)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SSRF_ALLOW_PRIVATE_HOSTS", "true");
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).resolves.toBeInstanceOf(URL);
  });

  it("stays strict in development without the env opt-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(resolveSafeUrl("http://127.0.0.1:9999/hook")).rejects.toThrow("内网/回环");
  });
});

describe("resolveSafeModelBaseUrl (F1)", () => {
  it("rejects the cloud metadata endpoint", async () => {
    await expect(resolveSafeModelBaseUrl("http://169.254.169.254/v1")).rejects.toThrow("云元数据");
  });

  it("rejects loopback by default", async () => {
    await expect(resolveSafeModelBaseUrl("http://127.0.0.1:11434/v1")).rejects.toThrow("内网/回环");
  });

  it("rejects a hostname resolving to a private address", async () => {
    lookup.mockResolvedValue([{ address: "10.1.2.3" }]);
    await expect(resolveSafeModelBaseUrl("http://vllm.internal:8000/v1")).rejects.toThrow("内网/回环");
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(resolveSafeModelBaseUrl("gopher://example.com/v1")).rejects.toThrow("仅允许 http/https");
  });

  it("accepts a public provider endpoint", async () => {
    lookup.mockResolvedValue([{ address: "104.18.6.192" }]);
    await expect(resolveSafeModelBaseUrl("https://api.openai.com/v1")).resolves.toBeInstanceOf(URL);
  });

  it("honours the self-hosted opt-in for private targets", async () => {
    process.env.LLM_ALLOW_PRIVATE_BASE_URL = "true";
    await expect(resolveSafeModelBaseUrl("http://127.0.0.1:11434/v1")).resolves.toBeInstanceOf(URL);
    lookup.mockResolvedValue([{ address: "192.168.1.50" }]);
    await expect(resolveSafeModelBaseUrl("http://ollama.lan:11434/v1")).resolves.toBeInstanceOf(URL);
  });

  it("still blocks cloud metadata even with the self-hosted opt-in", async () => {
    process.env.LLM_ALLOW_PRIVATE_BASE_URL = "true";
    await expect(resolveSafeModelBaseUrl("http://169.254.169.254/v1")).rejects.toThrow("云元数据");
  });
});

describe("modelBaseUrlPrecheck (hot read path)", () => {
  it("flags the cheap high-signal cases without a DNS lookup", () => {
    expect(modelBaseUrlPrecheck("file:///etc/passwd").ok).toBe(false);
    expect(modelBaseUrlPrecheck("http://169.254.169.254/v1").ok).toBe(false);
    expect(modelBaseUrlPrecheck("http://127.0.0.1:11434/v1").ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("passes hostnames through (write path owns the DNS check)", () => {
    expect(modelBaseUrlPrecheck("https://api.openai.com/v1").ok).toBe(true);
    expect(modelBaseUrlPrecheck("http://vllm.internal:8000/v1").ok).toBe(true);
  });

  it("applies the self-hosted opt-in to literals but never to metadata", () => {
    process.env.LLM_ALLOW_PRIVATE_BASE_URL = "true";
    expect(modelBaseUrlPrecheck("http://127.0.0.1:11434/v1").ok).toBe(true);
    expect(modelBaseUrlPrecheck("http://169.254.169.254/v1").ok).toBe(false);
  });
});
